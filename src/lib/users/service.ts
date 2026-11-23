import "server-only";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { account, session, user, type Role, type UserRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { generateTemporaryPassword } from "@/lib/auth/password";
import { requirePermission } from "@/lib/permissions";
import {
  createUserSchema,
  setActiveSchema,
  updateUserSchema,
  userIdSchema,
} from "./schema";

/** Fields safe to show and to put in audit_log. */
function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

export async function listUsers(): Promise<(PublicUser & { createdAt: Date })[]> {
  const rows = await db.select().from(user).orderBy(asc(user.name));
  return rows.map((u) => ({ ...publicUser(u), createdAt: u.createdAt }));
}

export async function countUsers(executor: DbOrTx = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(user);
  return row?.n ?? 0;
}

/** Insert a user with an email+password credential account. */
export async function insertUserWithPassword(
  executor: DbOrTx,
  data: {
    name: string;
    displayName: string;
    email: string;
    role: Role;
    password: string;
    mustChangePassword: boolean;
  },
): Promise<UserRow> {
  const [created] = await executor
    .insert(user)
    .values({
      name: data.name,
      displayName: data.displayName,
      email: data.email.toLowerCase(),
      emailVerified: true,
      role: data.role,
      active: true,
      mustChangePassword: data.mustChangePassword,
    })
    .returning();
  await executor.insert(account).values({
    accountId: created.id,
    providerId: "credential",
    userId: created.id,
    password: await hashPassword(data.password),
  });
  return created;
}

async function lockTarget(tx: DbOrTx, id: string): Promise<UserRow> {
  const [row] = await tx.select().from(user).where(eq(user.id, id)).for("update");
  if (!row) throw new ActionError(404, "User not found.");
  return row;
}

/**
 * Refuse a change that would leave no active Super Admin. Locks every active
 * Super Admin row so two concurrent demotions cannot both pass.
 */
async function assertAnotherActiveSuperAdmin(tx: DbOrTx, targetId: string) {
  const others = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "super_admin"), eq(user.active, true), ne(user.id, targetId)))
    .for("update");
  if (others.length === 0) {
    throw new ActionError(
      409,
      "This is the last active Super Admin. Make another user Super Admin first.",
    );
  }
}

async function revokeSessions(tx: DbOrTx, userId: string) {
  await tx.delete(session).where(eq(session.userId, userId));
}

export const createUser = defineAction({
  permission: "users.manage",
  input: createUserSchema,
  handler: async (actor, input) => {
    requirePermission(actor, "users.manage", { targetRoles: [input.role] });
    const temporaryPassword = generateTemporaryPassword();
    return db.transaction(async (tx) => {
      const exists = await tx.query.user.findFirst({
        where: eq(user.email, input.email),
        columns: { id: true },
      });
      if (exists) {
        throw new ActionError(409, "A user with this email already exists.", {
          email: ["Already in use"],
        });
      }
      const created = await insertUserWithPassword(tx, {
        ...input,
        password: temporaryPassword,
        mustChangePassword: true,
      });
      await withAudit(actor, "user.create", "user", created.id, null, publicUser(created), tx);
      return { user: publicUser(created), temporaryPassword };
    });
  },
});

export const updateUser = defineAction({
  permission: "users.manage",
  input: updateUserSchema,
  handler: async (actor, input) => {
    return db.transaction(async (tx) => {
      const target = await lockTarget(tx, input.id);
      requirePermission(actor, "users.manage", {
        targetRoles: [target.role, input.role],
      });
      if (target.role === "super_admin" && input.role !== "super_admin" && target.active) {
        await assertAnotherActiveSuperAdmin(tx, target.id);
      }
      const [updated] = await tx
        .update(user)
        .set({ name: input.name, displayName: input.displayName, role: input.role })
        .where(eq(user.id, target.id))
        .returning();
      await withAudit(
        actor,
        "user.update",
        "user",
        target.id,
        publicUser(target),
        publicUser(updated),
        tx,
      );
      return { user: publicUser(updated) };
    });
  },
});

export const setUserActive = defineAction({
  permission: "users.manage",
  input: setActiveSchema,
  handler: async (actor, input) => {
    return db.transaction(async (tx) => {
      const target = await lockTarget(tx, input.id);
      requirePermission(actor, "users.manage", { targetRoles: [target.role] });
      if (target.active === input.active) return { user: publicUser(target) };
      if (!input.active) {
        if (target.id === actor.id) {
          throw new ActionError(409, "You cannot deactivate your own account.");
        }
        if (target.role === "super_admin") {
          await assertAnotherActiveSuperAdmin(tx, target.id);
        }
      }
      const [updated] = await tx
        .update(user)
        .set({ active: input.active })
        .where(eq(user.id, target.id))
        .returning();
      if (!input.active) await revokeSessions(tx, target.id);
      await withAudit(
        actor,
        input.active ? "user.reactivate" : "user.deactivate",
        "user",
        target.id,
        publicUser(target),
        publicUser(updated),
        tx,
      );
      return { user: publicUser(updated) };
    });
  },
});

export const resetUserPassword = defineAction({
  permission: "users.manage",
  input: userIdSchema,
  handler: async (actor, input) => {
    const temporaryPassword = generateTemporaryPassword();
    const hash = await hashPassword(temporaryPassword);
    return db.transaction(async (tx) => {
      const target = await lockTarget(tx, input.id);
      requirePermission(actor, "users.manage", { targetRoles: [target.role] });
      const updatedAccounts = await tx
        .update(account)
        .set({ password: hash })
        .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
        .returning({ id: account.id });
      if (updatedAccounts.length === 0) {
        await tx.insert(account).values({
          accountId: target.id,
          providerId: "credential",
          userId: target.id,
          password: hash,
        });
      }
      const [updated] = await tx
        .update(user)
        .set({ mustChangePassword: true })
        .where(eq(user.id, target.id))
        .returning();
      await revokeSessions(tx, target.id);
      await withAudit(
        actor,
        "user.reset_password",
        "user",
        target.id,
        publicUser(target),
        publicUser(updated),
        tx,
      );
      return { user: publicUser(updated), temporaryPassword };
    });
  },
});

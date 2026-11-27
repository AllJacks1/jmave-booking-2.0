import "server-only";
import { and, desc, eq, gte, ilike, isNull, lt, sql, type SQL } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog, user } from "@/db/schema";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { can, requirePermission, type Actor } from "@/lib/permissions";
import { addDaysToKey, isDateKey, manilaToUtc } from "@/lib/time";

export const AUDIT_PAGE_SIZE = 50;

/** Audit viewer pages: Admin and up (PLAN §2); everyone else gets a real 403. */
export async function requireAuditPage(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!can(u, "audit.view")) forbidden();
  return u;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))
    .catch(undefined);

export const auditListSchema = z.object({
  /** User id, or "system" for rows without an actor (public requests, jobs). */
  actor: z.union([z.uuid(), z.literal("system"), z.literal("all")]).catch("all").default("all"),
  entity: optionalText(60),
  entityId: optionalText(100),
  /** Prefix match: "booking." finds every booking action. */
  action: optionalText(80),
  from: z.string().refine(isDateKey).optional().catch(undefined),
  to: z.string().refine(isDateKey).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type AuditListQuery = z.output<typeof auditListSchema>;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function auditConditions(q: AuditListQuery): SQL | undefined {
  const conds: SQL[] = [];
  if (q.actor === "system") conds.push(isNull(auditLog.actorId));
  else if (q.actor !== "all") conds.push(eq(auditLog.actorId, q.actor));
  if (q.entity) conds.push(eq(auditLog.entity, q.entity));
  if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));
  if (q.action) conds.push(ilike(auditLog.action, `${escapeLike(q.action)}%`));
  if (q.from) conds.push(gte(auditLog.at, manilaToUtc(q.from)));
  if (q.to) conds.push(lt(auditLog.at, manilaToUtc(addDaysToKey(q.to, 1))));
  return conds.length ? and(...conds) : undefined;
}

const listColumns = {
  id: auditLog.id,
  at: auditLog.at,
  action: auditLog.action,
  entity: auditLog.entity,
  entityId: auditLog.entityId,
  actorId: auditLog.actorId,
  actorName: user.displayName,
  actorRole: user.role,
};

/** Newest first. `actor` must hold `audit.view` (checked here too, not only on the page). */
export async function listAudit(actor: Actor, q: AuditListQuery) {
  requirePermission(actor, "audit.view");
  const where = auditConditions(q);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(listColumns)
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((q.page - 1) * AUDIT_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { rows, total };
}

export async function getAuditEntry(actor: Actor, id: string) {
  requirePermission(actor, "audit.view");
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({ ...listColumns, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(eq(auditLog.id, id));
  return row ?? null;
}

/** Filter options: entities and actions that exist, and every staff user. */
export async function auditFilterOptions(actor: Actor) {
  requirePermission(actor, "audit.view");
  const [entities, actions, users] = await Promise.all([
    db.selectDistinct({ v: auditLog.entity }).from(auditLog).orderBy(auditLog.entity),
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db.select({ id: user.id, displayName: user.displayName, active: user.active }).from(user).orderBy(user.displayName),
  ]);
  return { entities: entities.map((r) => r.v), actions: actions.map((r) => r.v), users };
}

/** Link from an audit row to the record's own page, when it has one. */
export function entityHref(entity: string, entityId: string | null): string | null {
  if (!entityId || !z.uuid().safeParse(entityId).success) return null;
  switch (entity) {
    case "booking":
      return `/bookings/${entityId}`;
    case "quotation":
      return `/quotes/${entityId}`;
    case "client":
      return `/clients/${entityId}`;
    case "loyalty_account":
      return `/rewards/${entityId}`;
    case "rate_card":
      return `/rates/${entityId}`;
    case "inquiry":
      return `/inquiries/${entityId}`;
    case "import_run":
      return `/import/${entityId}`;
    default:
      return null;
  }
}

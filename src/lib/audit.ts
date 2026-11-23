import "server-only";
import { db, type DbOrTx } from "@/db/client";
import { auditLog } from "@/db/schema";

const SECRET_KEYS =
  /^(password|newPassword|currentPassword|temporaryPassword|secret|token|setupToken|accessToken|refreshToken|idToken)$/i;

/** Remove secret-looking keys so they never land in audit_log. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? "[redacted]" : redactSecrets(v),
      ]),
    );
  }
  return value;
}

/**
 * Write one `audit_log` row. Pass the open transaction as `executor` so the
 * audit row commits or rolls back together with the change it records.
 *
 * Used for every write to prices, bookings, payments, users and settings.
 */
export async function withAudit(
  actor: { id: string } | null,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  executor: DbOrTx = db,
) {
  await executor.insert(auditLog).values({
    actorId: actor?.id ?? null,
    action,
    entity,
    entityId,
    before: before === undefined ? null : redactSecrets(before),
    after: after === undefined ? null : redactSecrets(after),
  });
}

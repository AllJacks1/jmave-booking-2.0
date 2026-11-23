import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { settings } from "@/db/schema";
import { defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  SETTINGS_SCHEMAS,
  settingsSchema,
  type Settings,
  type SettingsKey,
} from "./schema";

/** Insert any missing settings rows with their defaults (idempotent). */
export async function ensureDefaultSettings(executor: DbOrTx = db, actorId?: string) {
  await executor
    .insert(settings)
    .values(
      SETTINGS_KEYS.map((key) => ({
        key,
        value: DEFAULT_SETTINGS[key],
        updatedBy: actorId ?? null,
      })),
    )
    .onConflictDoNothing({ target: settings.key });
}

/** All settings, falling back to defaults for missing or invalid rows. */
export async function getSettings(executor: DbOrTx = db): Promise<Settings> {
  const rows = await executor
    .select()
    .from(settings)
    .where(inArray(settings.key, SETTINGS_KEYS));
  const out = structuredClone(DEFAULT_SETTINGS) as Record<SettingsKey, unknown>;
  for (const row of rows) {
    const key = row.key as SettingsKey;
    const parsed = SETTINGS_SCHEMAS[key].safeParse(row.value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Settings;
}

/** Super Admin only. Writes each changed key with its own audit row. */
export const updateSettings = defineAction({
  permission: "settings.edit",
  input: settingsSchema,
  handler: async (actor, input) => {
    return db.transaction(async (tx) => {
      // Serialise concurrent saves so before/after are accurate.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('settings'))`);
      const current = await getSettings(tx);
      const changed: SettingsKey[] = [];
      for (const key of SETTINGS_KEYS) {
        const before = current[key];
        const after = input[key];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        await tx
          .insert(settings)
          .values({ key, value: after, updatedBy: actor.id })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: after, updatedBy: actor.id, updatedAt: new Date() },
          });
        await withAudit(actor, "settings.update", "settings", key, before, after, tx);
        changed.push(key);
      }
      return { changed };
    });
  },
});

import "server-only";
import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { importRuns } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { ImportFileError, parseWorkbookBuffer } from "./parse";
import { planImport } from "./plan";
import type { ImportPayload, ImportSummary } from "./types";

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

/** Checks before parsing: Super Admin, `.xlsx`, size, zip signature. */
export function validateUpload(fileName: string, bytes: Uint8Array): string | null {
  if (!/\.xlsx$/i.test(fileName)) return "Only .xlsx files can be imported.";
  if (bytes.byteLength === 0) return "The file is empty.";
  if (bytes.byteLength > MAX_IMPORT_BYTES) return `The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`;
  // .xlsx is a zip: "PK\x03\x04"
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    return "The file is not a valid .xlsx workbook.";
  }
  return null;
}

export type UploadResult =
  | { ok: true; runId: string; summary: ImportSummary }
  | { ok: false; status: 400 | 401 | 403; error: string; runId?: string };

/**
 * Parse an upload and store a `previewed` run (payload kept for Commit).
 * A workbook that cannot be read is stored as a `failed` run.
 */
export async function previewUpload(
  actor: CurrentUser | null,
  fileName: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  try {
    requirePermission(actor, "import.run");
  } catch {
    return actor ? { ok: false, status: 403, error: "You do not have permission to import." } : { ok: false, status: 401, error: "You are not signed in." };
  }
  if (actor.mustChangePassword) return { ok: false, status: 403, error: "Change your password first." };
  const invalid = validateUpload(fileName, bytes);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const sha = createHash("sha256").update(bytes).digest("hex");
  let payload: ImportPayload;
  try {
    payload = await parseWorkbookBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (err) {
    const message = err instanceof ImportFileError ? err.message : "The workbook could not be read.";
    if (!(err instanceof ImportFileError)) console.error("Import parse failed:", err instanceof Error ? err.message : "unknown");
    const [run] = await db
      .insert(importRuns)
      .values({ fileName, fileSha256: sha, fileSize: bytes.byteLength, kind: "unknown", status: "failed", summary: {}, error: message, createdBy: actor.id })
      .returning({ id: importRuns.id });
    return { ok: false, status: 400, error: message, runId: run.id };
  }

  const { summary } = await planImport(payload, db);
  const [run] = await db
    .insert(importRuns)
    .values({
      fileName,
      fileSha256: sha,
      fileSize: bytes.byteLength,
      kind: payload.kind,
      status: "previewed",
      summary,
      payload,
      createdBy: actor.id,
    })
    .returning({ id: importRuns.id });
  return { ok: true, runId: run.id, summary };
}

/** Apply a previewed run in one transaction. The plan is recomputed inside it. */
export const commitImport = defineAction({
  permission: "import.run",
  input: z.object({ runId: z.uuid() }),
  handler: async (actor, { runId }) => {
    return db.transaction(async (tx) => {
      // One import at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('import'))`);
      const [run] = await tx.select().from(importRuns).where(eq(importRuns.id, runId)).for("update");
      if (!run) throw new ActionError(404, "Import run not found.");
      if (run.status !== "previewed" || !run.payload) {
        throw new ActionError(409, `This run is ${run.status}; upload the file again to import it.`);
      }
      const { summary, ops } = await planImport(run.payload as ImportPayload, tx);
      for (const op of ops) await op(tx, actor);
      await tx
        .update(importRuns)
        .set({ status: "committed", summary, payload: null, committedBy: actor.id, committedAt: new Date() })
        .where(eq(importRuns.id, runId));
      await withAudit(actor, "import.commit", "import_run", runId, null, { fileName: run.fileName, kind: run.kind, totals: summary.totals }, tx);
      return { runId, totals: summary.totals };
    });
  },
});

export async function listImportRuns(limit = 50) {
  return db
    .select({
      id: importRuns.id,
      fileName: importRuns.fileName,
      kind: importRuns.kind,
      status: importRuns.status,
      fileSize: importRuns.fileSize,
      error: importRuns.error,
      createdAt: importRuns.createdAt,
      committedAt: importRuns.committedAt,
      totals: sql<ImportSummary["totals"] | null>`${importRuns.summary} -> 'totals'`,
    })
    .from(importRuns)
    .orderBy(desc(importRuns.createdAt))
    .limit(limit);
}

export async function getImportRun(id: string) {
  const [run] = await db
    .select({
      id: importRuns.id,
      fileName: importRuns.fileName,
      fileSha256: importRuns.fileSha256,
      kind: importRuns.kind,
      status: importRuns.status,
      fileSize: importRuns.fileSize,
      error: importRuns.error,
      summary: importRuns.summary,
      createdAt: importRuns.createdAt,
      committedAt: importRuns.committedAt,
    })
    .from(importRuns)
    .where(eq(importRuns.id, id));
  return run ? { ...run, summary: run.summary as ImportSummary | Record<string, never> } : null;
}

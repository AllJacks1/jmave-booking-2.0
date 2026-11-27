/**
 * Worker entry (Railway service `worker`, `pnpm worker`).
 * Graceful shutdown on SIGTERM / SIGINT: stop taking jobs, finish the
 * current ones, close the database pools.
 */
// Sentry first, so start-up errors are reported too (Phase 5).
import { flushWorkerSentry, initWorkerSentry, reportWorkerError } from "./sentry";
import { closeDb } from "@/db/client";
import { startWorker } from "./app";

initWorkerSentry();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("worker: DATABASE_URL is not set");
    process.exit(1);
  }
  const worker = await startWorker({ databaseUrl });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ at: new Date().toISOString(), svc: "worker", msg: "signal", signal }));
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    try {
      await worker.stop();
      await closeDb();
      await flushWorkerSentry();
      process.exit(0);
    } catch (err) {
      console.error("worker: shutdown failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (err: unknown) => {
  console.error("worker: failed to start:", err instanceof Error ? err.message : err);
  reportWorkerError("worker failed to start", { error: err instanceof Error ? err.message : String(err) });
  await flushWorkerSentry();
  process.exit(1);
});

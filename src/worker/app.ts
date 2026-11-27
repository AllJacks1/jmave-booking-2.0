/**
 * Worker service (PLAN §3, Phase 3): pg-boss for schedules, the outbox
 * sender, and the nightly sweeps. Started by `src/worker/index.ts`.
 *
 * Jobs
 * - `outbox-dispatch`   every minute, and right away when a request enqueues
 *                       (LISTEN `outbox`). Sends due outbox rows (backoff and
 *                       max attempts live on the row, see lib/outbox/backoff).
 * - `nightly-expire-quotations`  00:05 Asia/Manila.
 * - `nightly-expire-loyalty`     00:05 Asia/Manila.
 *
 * Logs carry ids and counts only: never payloads (they hold client emails),
 * never the Rework URL (its token is a query parameter).
 */
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { db } from "@/db/client";
import { emailHandler } from "@/lib/email/outbox-handler";
import type { EmailTransport } from "@/lib/email/types";
import { expireLoyalty, expireQuotations } from "@/lib/jobs/nightly";
import { processOutbox, type OutboxHandlers } from "@/lib/outbox/dispatch";
import { OUTBOX_CHANNEL } from "@/lib/outbox/enqueue";
import { reworkConfigStatus } from "@/lib/rework/endpoint";
import { reworkHandler, type ReworkTransport } from "@/lib/rework/outbox-handler";
import { resolveAttachment } from "./attachments";
import { resendTransport } from "./resend";
import { reworkTransport } from "./rework";

export const QUEUES = {
  dispatch: "outbox-dispatch",
  expireQuotations: "nightly-expire-quotations",
  expireLoyalty: "nightly-expire-loyalty",
} as const;

export const NIGHTLY_CRON = "5 0 * * *";
export const TIME_ZONE = "Asia/Manila";

type Log = (msg: string, extra?: Record<string, unknown>) => void;

const log: Log = (msg, extra) => console.log(JSON.stringify({ at: new Date().toISOString(), svc: "worker", msg, ...extra }));
const logError: Log = (msg, extra) => console.error(JSON.stringify({ at: new Date().toISOString(), svc: "worker", level: "error", msg, ...extra }));

function message(err: unknown): string {
  // Message only: error objects from the driver can carry connection details.
  return err instanceof Error ? err.message : String(err);
}

export type WorkerOptions = {
  databaseUrl: string;
  transport?: EmailTransport;
  emailFrom?: string;
  rework?: ReworkTransport;
};

export async function startWorker(opts: WorkerOptions) {
  const transport = opts.transport ?? resendTransport(process.env.RESEND_API_KEY);
  const handlers: OutboxHandlers = {
    email: emailHandler({ transport, from: opts.emailFrom ?? process.env.EMAIL_FROM, resolveAttachment }),
    rework_lead: reworkHandler(opts.rework ?? reworkTransport()),
  };

  // --- Outbox dispatch: one run at a time; a kick during a run re-runs once.
  let running: Promise<void> | null = null;
  let again = false;
  let stopping = false;
  const dispatch = (): Promise<void> => {
    if (stopping) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          const s = await processOutbox(db, handlers);
          if (s.sent || s.retrying || s.failed) log("outbox dispatched", s);
        } while (again && !stopping);
      } catch (err) {
        logError("outbox dispatch failed", { error: message(err) });
      } finally {
        running = null;
      }
    })();
    return running;
  };

  // --- pg-boss
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: 3 });
  boss.on("error", (err) => logError("pg-boss error", { error: message(err) }));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
  await boss.schedule(QUEUES.dispatch, "* * * * *", null, { tz: TIME_ZONE });
  await boss.schedule(QUEUES.expireQuotations, NIGHTLY_CRON, null, { tz: TIME_ZONE });
  await boss.schedule(QUEUES.expireLoyalty, NIGHTLY_CRON, null, { tz: TIME_ZONE });

  await boss.work(QUEUES.dispatch, async () => {
    await dispatch();
  });
  await boss.work(QUEUES.expireQuotations, async () => {
    const n = await expireQuotations(db);
    log("quotations expired", { count: n });
  });
  await boss.work(QUEUES.expireLoyalty, async () => {
    const n = await expireLoyalty(db);
    log("loyalty cards expired", { count: n });
  });

  // --- Wake-ups from requests (pg_notify on commit). Polling stays the floor.
  const listener = postgres(opts.databaseUrl, { max: 1, onnotice: () => {} });
  const sub = await listener.listen(OUTBOX_CHANNEL, () => void dispatch());

  void dispatch();
  log("worker started", {
    queues: Object.values(QUEUES),
    nightlyCron: `${NIGHTLY_CRON} ${TIME_ZONE}`,
    emailTransport: transport.name,
    emailConfigured: Boolean(process.env.RESEND_API_KEY || opts.transport) && Boolean(opts.emailFrom ?? process.env.EMAIL_FROM),
    reworkConfigured: Boolean(opts.rework) || reworkConfigStatus(process.env).ready,
    node: process.version,
  });

  return {
    boss,
    dispatch,
    async stop() {
      stopping = true;
      log("worker stopping");
      await sub.unlisten().catch(() => {});
      await boss.stop({ graceful: true, timeout: 20_000 });
      if (running) await running;
      await listener.end({ timeout: 5 });
      log("worker stopped");
    },
  };
}

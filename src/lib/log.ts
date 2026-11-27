/**
 * Structured JSON logs (Phase 5). One line per event on stdout/stderr, which
 * Railway collects. Every string is scrubbed (emails, phones, tokens, env
 * secrets; src/lib/observability/scrub.ts) before it is written.
 *
 * Use `log.*` instead of `console.*` in app code (a test scans for strays).
 * Pass `requestId` (from the `x-request-id` header) when there is one.
 */
import { envSecrets, scrubValue } from "@/lib/observability/scrub";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

export function errorFields(err: unknown): Fields {
  if (err instanceof Error) return { error: err.message, errorName: err.name };
  return { error: typeof err === "string" ? err : "unknown" };
}

export function formatLine(svc: string, level: Level, msg: string, fields: Fields = {}, now = new Date(), secrets = envSecrets()): string {
  const body = scrubValue({ ...fields, msg }, { secrets }) as Fields;
  return JSON.stringify({ at: now.toISOString(), svc, level, ...body });
}

export function makeLogger(svc: string) {
  const write = (level: Level, msg: string, fields?: Fields) => {
    const line = formatLine(svc, level, msg, fields);
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (msg: string, fields?: Fields) => {
      if (process.env.LOG_LEVEL === "debug") write("debug", msg, fields);
    },
    info: (msg: string, fields?: Fields) => write("info", msg, fields),
    warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
    error: (msg: string, fields?: Fields) => write("error", msg, fields),
  };
}

export const log = makeLogger("web");

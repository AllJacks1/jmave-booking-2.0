import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxRow } from "@/db/schema";
import { reworkRequestUrl } from "@/lib/rework/endpoint";
import { reworkHandler } from "@/lib/rework/outbox-handler";
import { reworkTransport } from "./rework";

const TOKEN = "tok_InventedSecret+/=123";
const ENV = { REWORK_WEBHOOK_URL: "https://webhooks.rework.test/leads/source/leadgen", REWORK_WEBHOOK_TOKEN: TOKEN };

describe("Rework transport: the token never leaves", () => {
  const logs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    logs.length = 0;
  });
  function captureConsole() {
    for (const m of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  }
  const row = (lead: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-0000000000aa", payload: { lead, source: "test", reference: null } }) as unknown as OutboxRow;

  it("posts JSON to the URL with ?token= and stores status + body (2 KB max)", async () => {
    captureConsole();
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      calls.push({ url: url.toString(), body: String(init.body) });
      return new Response(`{"ok":true,"echo":"${TOKEN}","pad":"${"x".repeat(3000)}"}`, { status: 201 });
    }) as unknown as typeof fetch;
    const send = reworkHandler(reworkTransport(ENV, fetchImpl));
    const res = (await send(row({ name: "Invented Lead" }))) as { status: number; body: string };
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get("token")).toBe(TOKEN);
    expect(JSON.parse(calls[0].body)).toEqual({ name: "Invented Lead" });
    expect(res.status).toBe(201);
    expect(res.body.length).toBeLessThanOrEqual(2048);
    expect(res.body).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("errors (HTTP and network) never contain the token", async () => {
    captureConsole();
    const url = reworkRequestUrl(ENV).toString();
    const http = reworkTransport(ENV, (async () => new Response(`bad token ${TOKEN} for ${url}`, { status: 401 })) as unknown as typeof fetch);
    const net = reworkTransport(ENV, (async () => {
      throw new TypeError(`fetch failed for ${url}`, { cause: new Error(`connect ECONNREFUSED ${url}`) });
    }) as unknown as typeof fetch);
    for (const t of [http, net]) {
      const err = await t.send({ name: "x" }, "id").catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      console.error("rework failed", err);
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).not.toContain(encodeURIComponent(TOKEN));
    }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(encodeURIComponent(TOKEN));
  });

  it("refuses an invalid payload", async () => {
    const send = reworkHandler(reworkTransport(ENV, (async () => new Response("")) as unknown as typeof fetch));
    await expect(send({ id: "x", payload: { nope: true } } as unknown as OutboxRow)).rejects.toThrow("Invalid Rework payload");
  });
});

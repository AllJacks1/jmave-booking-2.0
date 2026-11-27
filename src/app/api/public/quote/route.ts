import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { clientIp, QUOTES_PER_HOUR, rateKey, takeRateLimit } from "@/lib/public/guard";
import { publicQuote } from "@/lib/public/service";
import { NO_STORE, readJson } from "../body";

export const dynamic = "force-dynamic";

/** Public (no login): available cars for the chosen dates, with prices from the active rate card. */
export async function POST(request: Request) {
  // Phase 5: per-IP limit (hashed IP, rolling hour) so the price list cannot be scraped in bulk.
  if (!(await takeRateLimit(db, rateKey("quote", clientIp(request.headers)), new Date(), QUOTES_PER_HOUR))) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please try again later." }, { status: 429, headers: NO_STORE });
  }
  const body = await readJson(request);
  if (body === null) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: NO_STORE });
  const r = await publicQuote(body);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

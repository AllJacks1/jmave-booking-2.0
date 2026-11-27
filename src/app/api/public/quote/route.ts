import { NextResponse } from "next/server";
import { publicQuote } from "@/lib/public/service";
import { NO_STORE, readJson } from "../body";

export const dynamic = "force-dynamic";

/** Public (no login): available cars for the chosen dates, with prices from the active rate card. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body === null) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: NO_STORE });
  const r = await publicQuote(body);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

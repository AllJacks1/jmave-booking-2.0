import { NextResponse } from "next/server";
import { submitInquiry } from "@/lib/public/service";
import { NO_STORE, readJson } from "../body";

export const dynamic = "force-dynamic";

/**
 * Public (no login): send a booking request. Turnstile, honeypot and a
 * per-IP limit (5/hour) are checked in `submitInquiry`. Nothing holds a car.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body === null) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: NO_STORE });
  const r = await submitInquiry(body, { headers: request.headers });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

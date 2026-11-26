import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { boardData } from "@/lib/board/service";
import { todayKey } from "@/lib/movements";
import { renderBoardPdf } from "@/lib/pdf/board";
import { pdfResponse } from "@/lib/pdf/response";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/service";
import { addDaysToKey, isDateKey } from "@/lib/time";

const MAX_DAYS = 7;

/** Board PDF: `GET /api/board/pdf?date=YYYY-MM-DD&days=1` — A4 landscape, one page per day. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.mustChangePassword || !can(user, "board.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const now = new Date();
  const qDate = req.nextUrl.searchParams.get("date");
  const date = qDate && isDateKey(qDate) ? qDate : todayKey(now);
  const n = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("days") ?? "1", 10) || 1));
  const dates = Array.from({ length: n }, (_, i) => addDaysToKey(date, i));
  const [settings, ...days] = await Promise.all([getSettings(), ...dates.map((d) => boardData(d, now))]);
  const buf = await renderBoardPdf(
    days.map((d) => ({ day: d.day, lookAhead: d.lookAhead, roster: d.roster })),
    now,
    settings.business.name,
  );
  return pdfResponse(buf, `daily-movement-${date}${n > 1 ? `-${n}d` : ""}.pdf`);
}

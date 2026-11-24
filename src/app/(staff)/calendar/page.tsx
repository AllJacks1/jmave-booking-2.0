import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/auth/session";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/constants";
import { calendarBounds, calendarDays, parseAnchor, placeBars, shiftAnchor } from "@/lib/calendar/layout";
import { CALENDAR_STATUS_FILTERS, calendarData, calendarFilterSchema, type CalendarFilters } from "@/lib/calendar/service";
import { can } from "@/lib/permissions";
import { BODY_TYPE_LABELS, BODY_TYPES } from "@/lib/pricing";
import { formatManilaDate, manilaDateKey } from "@/lib/time";
import { CalendarGrid, type CalendarRow } from "./calendar-grid";

export const metadata: Metadata = { title: "Calendar" };

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "calendar.view")) forbidden();
  const raw = await searchParams;
  const f = calendarFilterSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined)));
  const today = manilaDateKey(new Date());
  const anchor = parseAnchor(f.date, today);
  const days = calendarDays(f.view, anchor);
  const { from, to } = calendarBounds(days);
  const data = await calendarData(from, to, f);

  const rows: CalendarRow[] = data.vehicles.map((v) => {
    const mine = data.items.filter((i) => i.vehicleId === v.id).map((i) => ({ ...i, start: new Date(i.start), end: new Date(i.end) }));
    const placed = placeBars(mine, from, to);
    return {
      vehicle: v,
      lanes: placed.lanes,
      bars: placed.bars.map((bar) => ({ ...bar, start: bar.start.toISOString(), end: bar.end.toISOString() })),
    };
  });

  const href = (patch: Partial<CalendarFilters>) => {
    const p = new URLSearchParams();
    const next = { ...f, date: anchor, ...patch };
    for (const [k, v] of Object.entries(next)) if (v && v !== "all") p.set(k, String(v));
    return `/calendar?${p}`;
  };
  const readOnly = !can(user, "bookings.manage");
  const title = f.view === "week" ? `${formatManilaDate(days[0])} – ${formatManilaDate(days[days.length - 1])}` : formatManilaDate(days[0]).replace(/ \d+,/, ",");

  return (
    <>
      <PageHeader title="Calendar" description={readOnly ? "Fleet bookings and blocks (view only)." : "Fleet bookings and blocks. Click an empty day to quote that car."} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="outline" aria-label="Previous">
            <Link href={href({ date: shiftAnchor(f.view, anchor, -1) })}>
              <ChevronLeftIcon />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={href({ date: today })}>Today</Link>
          </Button>
          <Button asChild size="icon" variant="outline" aria-label="Next">
            <Link href={href({ date: shiftAnchor(f.view, anchor, 1) })}>
              <ChevronRightIcon />
            </Link>
          </Button>
          <h2 className="ml-2 text-base font-medium" data-testid="calendar-title">
            {title}
          </h2>
        </div>
        <div className="flex rounded-md border p-0.5">
          {(["week", "month"] as const).map((v) => (
            <Button key={v} asChild size="sm" variant={f.view === v ? "secondary" : "ghost"}>
              <Link href={href({ view: v })}>{v === "week" ? "Week" : "Month"}</Link>
            </Button>
          ))}
        </div>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="view" value={f.view} />
        <input type="hidden" name="date" value={anchor} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="body">Body type</Label>
          <select id="body" name="body" defaultValue={f.body} className={selectClass}>
            <option value="all">All</option>
            {BODY_TYPES.map((b) => (
              <option key={b} value={b}>
                {BODY_TYPE_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={f.status} className={selectClass}>
            {CALENDAR_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All" : s === "block" ? "Blocks" : BOOKING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service">Service</Label>
          <select id="service" name="service" defaultValue={f.service} className={selectClass}>
            <option value="all">All</option>
            <option value="self_drive">Self-Drive</option>
            <option value="with_driver">With Driver</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <CalendarGrid
        view={f.view}
        days={days}
        today={today}
        rows={rows}
        canQuote={can(user, "quotes.manage")}
        canOpenBooking={can(user, "bookings.manage")}
        canBlock={can(user, "vehicle_blocks.manage")}
      />
    </>
  );
}

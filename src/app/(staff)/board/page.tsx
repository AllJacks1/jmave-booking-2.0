import { PrinterIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NoAccess } from "@/components/placeholders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePage } from "@/lib/auth/page";
import { boardData } from "@/lib/board/service";
import { BLOCK_KIND_LABELS, DUTY_LABELS } from "@/lib/bookings/constants";
import {
  DAY_STATUS_LABELS,
  DAY_STATUSES,
  slotLabel,
  todayKey,
  type BoardBooking,
  type DayStatus,
  type TimelineEvent,
  type VehicleDay,
} from "@/lib/movements";
import { can } from "@/lib/permissions";
import { fmtPeso, fmtTime } from "@/lib/quotes/document";
import { addDaysToKey, formatManilaDate, isDateKey, manilaTime, weekdayShort } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BoardControls } from "./board-controls";

export const metadata: Metadata = { title: "Movement board" };

const DAY_STATUS_CLASSES: Record<DayStatus, string> = {
  return: "border-violet-600 bg-violet-600 text-white",
  out_today: "border-emerald-600 bg-emerald-600 text-white",
  rented: "border-sky-600 bg-sky-600 text-white",
  blocked: "border-zinc-500 bg-zinc-400 text-zinc-950 dark:bg-zinc-600 dark:text-zinc-50",
  pending:
    "border-amber-500 text-amber-950 dark:text-amber-50 bg-[repeating-linear-gradient(135deg,var(--color-amber-200)_0_6px,var(--color-amber-100)_6px_12px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-amber-800)_0_6px,var(--color-amber-950)_6px_12px)]",
  available: "border-border text-muted-foreground",
};

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { user, allowed } = await requirePage("board.view");
  if (!allowed) return <NoAccess />;
  const sp = await searchParams;
  const now = new Date();
  const today = todayKey(now);
  const date = sp.date && isDateKey(sp.date) ? sp.date : today;
  const data = await boardData(date, now);
  const { day, lookAhead, roster } = data;
  const canCheckIn = can(user, "movement.check_in");
  const canOpen = can(user, "bookings.manage");
  const isToday = date === today;
  const [hh, mm] = manilaTime(now).split(":").map(Number);
  const nowSlot = isToday ? Math.floor((hh * 60 + mm) / 30) : -1;
  const slots = [...new Set(day.events.map((e) => e.slot))].sort((a, b) => a - b);
  const templateName = new Map(roster.templates.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-4" data-testid="board">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Daily movement · {weekdayShort(date)} {formatManilaDate(date)}</h1>
          <p className="text-sm text-muted-foreground">As of {manilaTime(now)} · refreshes every minute</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoardControls date={date} prev={addDaysToKey(date, -1)} next={addDaysToKey(date, 1)} today={today} />
          <Button asChild variant="outline">
            <a href={`/api/board/pdf?date=${date}`} target="_blank" rel="noreferrer">
              <PrinterIcon />
              Print / PDF
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="board-counts">
        {DAY_STATUSES.map((s) => (
          <Badge key={s} variant="outline" className={cn("gap-1.5", DAY_STATUS_CLASSES[s])}>
            {DAY_STATUS_LABELS[s]} <span className="tabular-nums">{day.counts[s]}</span>
          </Badge>
        ))}
      </div>

      {/* Fleet status */}
      <Section title="Fleet status" description={`${day.rows.length} active vehicles`}>
        {day.rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">No active vehicles. Add them at Fleet.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="w-10 py-2 pl-6">#</th>
                    <th className="py-2">Car</th>
                    <th className="py-2">Client</th>
                    <th className="py-2">Destination</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Today</th>
                    <th className="py-2 text-right">Daily rate</th>
                    <th className="py-2 text-right">Balance</th>
                    <th className="py-2 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {day.rows.map((r, i) => (
                    <tr key={r.vehicle.id} className="border-b align-top last:border-0" data-testid="board-row" data-vehicle={r.vehicle.displayName} data-status={r.primary}>
                      <td className="py-2 pl-6 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="py-2">
                        <p className="font-medium">{r.vehicle.displayName}</p>
                        {r.vehicle.plate ? <p className="text-xs text-muted-foreground">{r.vehicle.plate}</p> : null}
                      </td>
                      <td className="py-2">{clientCell(r)}</td>
                      <td className="py-2">{r.booking?.destination ?? (r.block ? r.block.reason : "—")}</td>
                      <td className="py-2">
                        <Statuses row={r} />
                      </td>
                      <td className="py-2">
                        <Chips events={r.events} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.vehicle.dailyRateDisplay ? fmtPeso(r.vehicle.dailyRateDisplay) : "—"}</td>
                      <td className="py-2 text-right tabular-nums">{balanceCell(r.booking)}</td>
                      <td className="py-2 pr-6">
                        <RowActions row={r} canCheckIn={canCheckIn} canOpen={canOpen} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 px-4 md:hidden">
              {day.rows.map((r, i) => (
                <div key={r.vehicle.id} className="rounded-lg border p-3" data-testid="board-card" data-vehicle={r.vehicle.displayName} data-status={r.primary}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}.</span>
                        {r.vehicle.displayName}
                      </p>
                      {r.vehicle.plate ? <p className="text-xs text-muted-foreground">{r.vehicle.plate}</p> : null}
                    </div>
                    <Statuses row={r} />
                  </div>
                  {r.booking || r.block ? (
                    <div className="mt-2 text-sm">
                      {clientCell(r)}
                      {r.booking?.destination ? <p className="text-xs text-muted-foreground">{r.booking.destination}</p> : null}
                      {r.booking?.balance ? <p className="text-xs">Balance {fmtPeso(r.booking.balance)}</p> : null}
                    </div>
                  ) : null}
                  {r.events.length ? (
                    <div className="mt-2">
                      <Chips events={r.events} />
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <RowActions row={r} canCheckIn={canCheckIn} canOpen={canOpen} big />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Timeline */}
        <Section title="Movement timeline" description="30-minute slots. Actual time once checked in.">
          {slots.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">No movements this day.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm" data-testid="timeline">
                <thead className="border-b text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="w-16 py-2 pl-6">Time</th>
                    <th className="py-2">Out</th>
                    <th className="py-2">Extend</th>
                    <th className="py-2 pr-6">In</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => {
                    const ev = day.events.filter((e) => e.slot === s);
                    return (
                      <tr key={s} className={cn("border-b align-top last:border-0", s === nowSlot && "bg-muted/60")}>
                        <td className="py-2 pl-6 font-medium tabular-nums">{slotLabel(s)}</td>
                        {(["OUT", "EXT", "IN"] as const).map((k) => (
                          <td key={k} className={cn("py-2", k === "IN" && "pr-6")}>
                            <div className="flex flex-col gap-1">
                              {ev
                                .filter((e) => e.kind === k)
                                .map((e) => (
                                  <EventChip key={e.key} e={e} />
                                ))}
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="With Driver trips">
            {day.withDriver.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground">No With Driver trips.</p>
            ) : (
              <ul className="flex flex-col gap-2 px-6 text-sm" data-testid="wd-trips">
                {day.withDriver.map((t) => (
                  <li key={t.bookingId} className="flex flex-wrap justify-between gap-x-4">
                    <span>
                      <span className="font-medium">{t.clientName ?? "No client"}</span> · {t.vehicle?.displayName ?? "—"}
                      {t.vehicle?.plate ? ` (${t.vehicle.plate})` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {t.driverName ?? <span className="text-amber-700 dark:text-amber-400">Waiting driver…</span>} · {fmtTime(t.startAt)}–{fmtTime(t.endAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Special instructions">
            {day.instructions.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground">Nothing special.</p>
            ) : (
              <ul className="flex flex-col gap-2 px-6 text-sm" data-testid="instructions">
                {day.instructions.map((x, i) => (
                  <li key={`${x.bookingId}-${x.kind}-${i}`}>
                    <Badge variant="outline" className="mr-2">
                      {x.kind === "NOTE" ? "Note" : x.kind}
                    </Badge>
                    <span className="font-medium">{x.vehicle?.displayName ?? x.number}</span>
                    {x.at ? <span className="text-muted-foreground"> · {fmtTime(x.at)}</span> : null}
                    <span className="block whitespace-pre-wrap text-muted-foreground">{x.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="On duty" description={<Link href={`/roster?week=${date}`} className="underline-offset-4 hover:underline">Roster</Link>}>
            {roster.today.length + roster.carried.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground">No shifts set for this day.</p>
            ) : (
              <ul className="flex flex-col gap-1 px-6 text-sm" data-testid="board-roster">
                {roster.carried.map((e) => (
                  <li key={e.id} className="text-muted-foreground">
                    {e.userName} · {templateName.get(e.templateId)} ({DUTY_LABELS[e.duty]}, from the night before)
                  </li>
                ))}
                {roster.today.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{e.userName}</span> · {templateName.get(e.templateId)} · {DUTY_LABELS[e.duty]}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {/* Look-ahead */}
      <Section title="Look ahead (5 days)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" data-testid="look-ahead">
            <thead className="border-b text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pl-6">Car</th>
                {lookAhead[0]?.days.map((d) => (
                  <th key={d.date} className="py-2 last:pr-6">
                    <Link href={`/board?date=${d.date}`} className="hover:underline">
                      {weekdayShort(d.date)} {d.date.slice(5)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lookAhead.map((r) => (
                <tr key={r.vehicle.id} className="border-b align-top last:border-0">
                  <td className="py-1.5 pl-6 font-medium whitespace-nowrap">{r.vehicle.displayName}</td>
                  {r.days.map((d) => (
                    <td key={d.date} className="py-1.5 text-xs last:pr-6">
                      {d.events.length ? (
                        d.events.map((e) => (
                          <p key={e.key} className="whitespace-nowrap">
                            <span className="font-medium">{[e.kind, ...e.codes].join(" ")}</span> {fmtTime(e.at)}
                          </p>
                        ))
                      ) : d.statuses[0] === "rented" || d.statuses[0] === "blocked" ? (
                        <span className="text-muted-foreground">{DAY_STATUS_LABELS[d.statuses[0]]}</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="gap-3 pb-3">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

function clientCell(r: VehicleDay) {
  if (r.booking) {
    return (
      <span>
        <span className="font-medium">{r.booking.clientName ?? "No client"}</span>
        <span className="block text-xs text-muted-foreground">{r.booking.number}</span>
      </span>
    );
  }
  if (r.block) return <span className="text-muted-foreground">{BLOCK_KIND_LABELS[r.block.kind]}</span>;
  return <span className="text-muted-foreground">—</span>;
}

function balanceCell(b: BoardBooking | null) {
  if (!b || b.balance === undefined) return "—";
  return (
    <span className={b.balance > 0 ? "text-amber-700 dark:text-amber-400" : undefined}>
      {fmtPeso(b.balance)}
      {b.depositHeld ? <span className="block text-xs text-muted-foreground">Deposit {fmtPeso(b.depositHeld)}</span> : null}
    </span>
  );
}

function Statuses({ row }: { row: VehicleDay }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.statuses.map((s) => (
        <Badge key={s} variant="outline" className={DAY_STATUS_CLASSES[s]} data-testid="day-status">
          {DAY_STATUS_LABELS[s]}
        </Badge>
      ))}
      {row.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
      {row.releaseOverdue ? <Badge variant="destructive">Not released</Badge> : null}
    </div>
  );
}

function Chips({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {events.map((e) => (
        <EventChip key={e.key} e={e} />
      ))}
    </div>
  );
}

function EventChip({ e }: { e: TimelineEvent }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit flex-wrap items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
        e.kind === "OUT" && "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950",
        e.kind === "IN" && "border-violet-600/40 bg-violet-50 dark:bg-violet-950",
        e.kind === "EXT" && "border-sky-600/40 bg-sky-50 dark:bg-sky-950",
        e.codes.includes("PR") && "border-dashed",
      )}
      data-testid="event-chip"
      data-kind={e.kind}
      data-done={e.done}
    >
      <span className="font-semibold">{[e.kind, ...e.codes].join(" ")}</span>
      <span className="tabular-nums">{fmtTime(e.plannedAt)}</span>
      {e.actualAt ? <span className="tabular-nums text-emerald-700 dark:text-emerald-400">✓ {fmtTime(e.actualAt)}</span> : null}
      {e.kind === "EXT" && e.newEndAt ? <span className="tabular-nums">→ {fmtTime(e.newEndAt)}</span> : null}
      <span className="text-muted-foreground">{e.label.split(" - ").slice(1).join(" - ")}</span>
    </span>
  );
}

function RowActions({ row, canCheckIn, canOpen, big = false }: { row: VehicleDay; canCheckIn: boolean; canOpen: boolean; big?: boolean }) {
  const items: ReactNode[] = [];
  for (const b of row.bookings) {
    if (canCheckIn && b.status === "confirmed") {
      items.push(
        <Button key={`${b.id}-rel`} asChild size={big ? "default" : "sm"} className={big ? "flex-1" : undefined}>
          <Link href={`/board/release/${b.id}`} aria-label={`Release ${b.number}`}>
            Release
          </Link>
        </Button>,
      );
    }
    if (canCheckIn && b.status === "released") {
      items.push(
        <Button key={`${b.id}-ret`} asChild size={big ? "default" : "sm"} variant="secondary" className={big ? "flex-1" : undefined}>
          <Link href={`/board/return/${b.id}`} aria-label={`Return ${b.number}`}>
            Return
          </Link>
        </Button>,
      );
    }
  }
  if (canOpen && row.booking) {
    items.push(
      <Button key="open" asChild size={big ? "default" : "sm"} variant="ghost">
        <Link href={`/bookings/${row.booking.id}`}>Open</Link>
      </Button>,
    );
  }
  if (items.length === 0) return null;
  return <div className={cn("flex flex-wrap gap-1", !big && "justify-end")}>{items}</div>;
}

"use client";

import { BanIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { STATUS_CLASSES } from "@/components/bookings/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { BLOCK_KIND_LABELS, BLOCK_KINDS, BOOKING_STATUS_LABELS, type BlockKind } from "@/lib/bookings/constants";
import type { CalendarView, PlacedBar } from "@/lib/calendar/layout";
import type { CalendarItem, CalendarVehicle } from "@/lib/calendar/service";
import { BODY_TYPE_LABELS } from "@/lib/pricing/types";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtShortDateTime } from "@/lib/quotes/document";
import { addDaysToKey, manilaDateKey, manilaTime, weekdayShort } from "@/lib/time";
import { cn } from "@/lib/utils";
import { endBlockAction, saveBlockAction } from "../bookings/actions";

type Bar = Omit<PlacedBar<CalendarItem & { start: Date; end: Date }>, "start" | "end"> & { start: string; end: string };
export type CalendarRow = { vehicle: CalendarVehicle; lanes: number; bars: Bar[] };

const LANE_PX = 26;
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

type BlockForm = { id: string | null; vehicleId: string; kind: BlockKind; startDate: string; startTime: string; endDate: string; endTime: string; reason: string };

export function CalendarGrid({
  view,
  days,
  today,
  rows,
  canQuote,
  canOpenBooking,
  canBlock,
}: {
  view: CalendarView;
  days: string[];
  today: string;
  rows: CalendarRow[];
  canQuote: boolean;
  canOpenBooking: boolean;
  canBlock: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Bar | null>(null);
  const [block, setBlock] = useState<BlockForm | null>(null);
  const [busy, setBusy] = useState(false);
  const colMin = view === "week" ? 132 : 40;
  const gridCols = `minmax(11rem, 14rem) repeat(${days.length}, minmax(${colMin}px, 1fr))`;

  const vehicleName = (id: string) => rows.find((r) => r.vehicle.id === id)?.vehicle.name ?? "";

  async function saveBlock() {
    if (!block) return;
    setBusy(true);
    const r = await saveBlockAction(block);
    setBusy(false);
    if (!r.ok) {
      const first = Object.values(r.fieldErrors ?? {})[0]?.[0];
      return void toast.error(first ? `${r.error} ${first}` : r.error);
    }
    toast.success(block.id ? "Block saved" : "Vehicle blocked");
    setBlock(null);
    setSelected(null);
    router.refresh();
  }

  async function endBlock(id: string) {
    setBusy(true);
    const r = await endBlockAction({ id });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Block ended");
    setSelected(null);
    router.refresh();
  }

  const newBlock = (vehicleId?: string, date?: string) => {
    const d = date ?? today;
    setBlock({ id: null, vehicleId: vehicleId ?? rows[0]?.vehicle.id ?? "", kind: "maintenance", startDate: d, startTime: "08:00", endDate: addDaysToKey(d, 1), endTime: "08:00", reason: "" });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        {canBlock ? (
          <Button variant="outline" size="sm" onClick={() => newBlock()}>
            <BanIcon />
            Block a vehicle
          </Button>
        ) : null}
      </div>
      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto" data-testid="calendar">
          <div className="grid min-w-max text-sm" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-20 border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground">Vehicle</div>
            {days.map((d) => (
              <div
                key={d}
                className={cn(
                  "border-b border-l px-1 py-2 text-center text-xs",
                  d === today && "bg-primary/10 font-semibold",
                  isWeekend(d) && d !== today && "bg-muted/50",
                )}
              >
                <div className="text-muted-foreground">{weekdayShort(d)}</div>
                <div>{view === "week" ? d.slice(5).replace("-", "/") : Number(d.slice(8))}</div>
              </div>
            ))}
            {rows.length === 0 ? (
              <div className="col-span-full px-3 py-8 text-center text-muted-foreground">No vehicles match.</div>
            ) : null}
            {rows.map((row, i) => {
              const header = i === 0 || row.vehicle.bodyType !== rows[i - 1].vehicle.bodyType;
              const height = row.lanes * LANE_PX + 8;
              return (
                <Row key={row.vehicle.id}>
                  {header ? (
                    <div className="sticky left-0 col-span-full border-b bg-muted/40 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {row.vehicle.bodyType ? BODY_TYPE_LABELS[row.vehicle.bodyType] : "Other"}
                    </div>
                  ) : null}
                  <div className="sticky left-0 z-10 flex flex-col justify-center border-b bg-card px-3 py-1" style={{ minHeight: height }}>
                    <span className="truncate font-medium" title={row.vehicle.name}>
                      {row.vehicle.name}
                    </span>
                    {row.vehicle.plate ? <span className="text-xs text-muted-foreground">{row.vehicle.plate}</span> : null}
                  </div>
                  <div className="relative border-b" style={{ gridColumn: `span ${days.length}`, minHeight: height }} data-testid={`calendar-row-${row.vehicle.id}`}>
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
                      {days.map((d) =>
                        canQuote ? (
                          <Link
                            key={d}
                            href={`/quotes/new?vehicle=${row.vehicle.id}&date=${d}`}
                            aria-label={`New quotation for ${row.vehicle.name} on ${d}`}
                            className={cn("border-l hover:bg-primary/5", d === today && "bg-primary/5", isWeekend(d) && "bg-muted/30")}
                          />
                        ) : (
                          <div key={d} className={cn("border-l", d === today && "bg-primary/5", isWeekend(d) && "bg-muted/30")} />
                        ),
                      )}
                    </div>
                    {row.bars.map((b) => (
                      <button
                        key={`${b.kind}-${b.id}`}
                        type="button"
                        onClick={() => setSelected(b)}
                        title={`${b.label}\n${fmtShortDateTime(new Date(b.start))} → ${fmtShortDateTime(new Date(b.end))}`}
                        data-testid="calendar-bar"
                        data-status={b.status}
                        data-number={b.number ?? undefined}
                        className={cn(
                          "absolute z-[1] truncate border px-1.5 text-left text-xs leading-[22px] shadow-xs hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          b.clippedStart ? "rounded-l-none border-l-0" : "rounded-l-md",
                          b.clippedEnd ? "rounded-r-none border-r-0" : "rounded-r-md",
                          STATUS_CLASSES[b.status],
                        )}
                        style={{ left: `${b.leftPct}%`, width: `max(${b.widthPct}%, 6px)`, top: 4 + b.lane * LANE_PX, height: LANE_PX - 3 }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </Row>
              );
            })}
          </div>
        </div>
      </Card>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent data-testid="calendar-drawer">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.kind === "booking" ? selected.number : `Blocked: ${BLOCK_KIND_LABELS[selected.blockKind ?? "other"]}`}</SheetTitle>
                <SheetDescription>{vehicleName(selected.vehicleId)}</SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 px-4 text-sm">
                {selected.kind === "booking" ? (
                  <>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{selected.status === "block" ? "" : BOOKING_STATUS_LABELS[selected.status]}</dd>
                    <dt className="text-muted-foreground">Client</dt>
                    <dd>{selected.clientName ?? "—"}</dd>
                    <dt className="text-muted-foreground">Service</dt>
                    <dd>{selected.service ? SERVICE_LABELS[selected.service] : "—"}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd className="whitespace-pre-wrap">{selected.reason}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{selected.kind === "booking" ? "Release" : "From"}</dt>
                <dd>{fmtShortDateTime(new Date(selected.start))}</dd>
                <dt className="text-muted-foreground">{selected.kind === "booking" ? "Return" : "Until"}</dt>
                <dd>{fmtShortDateTime(new Date(selected.end))}</dd>
              </dl>
              <SheetFooter>
                {selected.kind === "booking" && canOpenBooking ? (
                  <Button asChild>
                    <Link href={`/bookings/${selected.id}`}>
                      <ExternalLinkIcon />
                      Open booking
                    </Link>
                  </Button>
                ) : null}
                {selected.kind === "block" && canBlock && new Date(selected.end) > new Date() ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const s = new Date(selected.start);
                        const e = new Date(selected.end);
                        setBlock({
                          id: selected.id,
                          vehicleId: selected.vehicleId,
                          kind: selected.blockKind ?? "other",
                          startDate: manilaDateKey(s),
                          startTime: manilaTime(s),
                          endDate: manilaDateKey(e),
                          endTime: manilaTime(e),
                          reason: selected.reason ?? "",
                        });
                      }}
                    >
                      <PencilIcon />
                      Edit block
                    </Button>
                    <Button variant="destructive" disabled={busy} onClick={() => endBlock(selected.id)}>
                      {new Date(selected.start) > new Date() ? "Remove block" : "End block now"}
                    </Button>
                  </>
                ) : null}
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={block !== null} onOpenChange={(o) => !o && setBlock(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{block?.id ? "Edit block" : "Block a vehicle"}</DialogTitle>
            <DialogDescription>Owner use, maintenance and other blocks stop the car from being booked.</DialogDescription>
          </DialogHeader>
          {block ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="blk-vehicle">Vehicle</Label>
                <select id="blk-vehicle" className={selectClass} value={block.vehicleId} onChange={(e) => setBlock({ ...block, vehicleId: e.target.value })}>
                  {rows.map((r) => (
                    <option key={r.vehicle.id} value={r.vehicle.id}>
                      {r.vehicle.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="blk-kind">Kind</Label>
                <select id="blk-kind" className={selectClass} value={block.kind} onChange={(e) => setBlock({ ...block, kind: e.target.value as BlockKind })}>
                  {BLOCK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {BLOCK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-sd">From</Label>
                  <Input id="blk-sd" type="date" value={block.startDate} onChange={(e) => setBlock({ ...block, startDate: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-st">Time</Label>
                  <Input id="blk-st" type="time" value={block.startTime} onChange={(e) => setBlock({ ...block, startTime: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-ed">Until</Label>
                  <Input id="blk-ed" type="date" value={block.endDate} onChange={(e) => setBlock({ ...block, endDate: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-et">Time</Label>
                  <Input id="blk-et" type="time" value={block.endTime} onChange={(e) => setBlock({ ...block, endTime: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="blk-reason">Reason</Label>
                <Textarea id="blk-reason" rows={2} value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button disabled={busy} onClick={saveBlock}>
              Save block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function isWeekend(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return w === 0 || w === 6;
}

function Legend() {
  const items: [keyof typeof STATUS_CLASSES, string][] = [
    ["pending_reservation", "Pending"],
    ["confirmed", "Confirmed"],
    ["released", "Released"],
    ["returned", "Returned"],
    ["closed", "Closed"],
    ["block", "Blocked"],
  ];
  return (
    <ul className="flex flex-wrap gap-3 text-xs">
      {items.map(([k, label]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-5 rounded-sm border", STATUS_CLASSES[k])} />
          {label}
        </li>
      ))}
    </ul>
  );
}

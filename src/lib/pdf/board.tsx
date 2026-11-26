/**
 * Daily Movement board PDF (bookings-and-movement.md §6): A4 landscape, one
 * page per day. Same data as `/board`. Server only.
 */
import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { BLOCK_KIND_LABELS, DUTY_LABELS } from "@/lib/bookings/constants";
import { DAY_STATUS_LABELS, type BoardDay, type LookAheadRow, type TimelineEvent } from "@/lib/movements";
import { fmtPeso } from "@/lib/quotes/document";
import type { RosterEntry } from "@/lib/roster/service";
import { formatManilaDate, manilaTime, weekdayShort } from "@/lib/time";
import { registerPdfFonts } from "./fonts";

registerPdfFonts();

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#b91c1c";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 7.5, color: INK, paddingTop: 20, paddingHorizontal: 22, paddingBottom: 26, lineHeight: 1.2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 1.5, borderBottomColor: ACCENT, paddingBottom: 4, marginBottom: 6 },
  title: { fontSize: 13, fontWeight: 700, color: ACCENT },
  sub: { fontSize: 8, color: MUTED },
  counts: { flexDirection: "row", gap: 8, marginBottom: 5 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 2, fontWeight: 600, fontSize: 7 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 1.2 },
  trTight: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 0.4, fontSize: 7 },
  h2: { fontSize: 8.5, fontWeight: 700, marginTop: 5, marginBottom: 1.5 },
  cols: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  muted: { color: MUTED },
  footer: { position: "absolute", bottom: 12, left: 22, right: 22, fontSize: 6.5, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
});

const W = { n: 16, car: 130, client: 130, dest: 90, status: 90, moves: 220, rate: 55, bal: 60 };

export type BoardPdfDay = {
  day: BoardDay;
  lookAhead: LookAheadRow[];
  roster: { templates: { id: string; name: string }[]; today: RosterEntry[]; carried: RosterEntry[] };
};

function chip(e: TimelineEvent) {
  const t = e.actualAt ? `${hm(e.plannedAt)} [${hm(e.actualAt)}]` : hm(e.plannedAt);
  return `${[e.kind, ...e.codes].join(" ")} ${t}`;
}

/**
 * Cut text to what fits `lines` lines of a `w`-point column (7.5 pt Geist
 * averages ~3.9 pt per character), so a day always fits one page.
 */
export function clip(text: string, w: number, lines = 1): string {
  const max = Math.max(4, Math.floor(((w - 4) / 3.9) * lines));
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function Cell({ w, children, right, bold, lines = 1 }: { w: number; children: ReactNode; right?: boolean; bold?: boolean; lines?: number }) {
  const content = typeof children === "string" ? clip(children, w, lines) : children;
  return <Text style={{ width: w, paddingRight: 4, textAlign: right ? "right" : "left", fontWeight: bold ? 600 : 400 }}>{content}</Text>;
}

/** 24-hour Manila time, compact for the sheet. */
const hm = (d: Date) => manilaTime(d);

function DayPage({ d, asOf, business }: { d: BoardPdfDay; asOf: Date; business: string }) {
  const { day, lookAhead, roster } = d;
  const names = new Map(roster.templates.map((t) => [t.id, t.name]));
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <View style={s.header}>
        <Text style={s.title}>
          {business} · Daily Movement Sheet · {weekdayShort(day.date)} {formatManilaDate(day.date)}
        </Text>
        <Text style={s.sub}>As of {formatManilaDate(asOf)} {manilaTime(asOf)}</Text>
      </View>
      <View style={s.counts}>
        {(Object.keys(day.counts) as (keyof typeof day.counts)[]).map((k) => (
          <Text key={k}>
            {DAY_STATUS_LABELS[k]}: <Text style={{ fontWeight: 700 }}>{day.counts[k]}</Text>
          </Text>
        ))}
      </View>

      <View style={s.th}>
        <Cell w={W.n}>#</Cell>
        <Cell w={W.car}>Car</Cell>
        <Cell w={W.client}>Client</Cell>
        <Cell w={W.dest}>Destination</Cell>
        <Cell w={W.status}>Status</Cell>
        <Cell w={W.moves}>Movements</Cell>
        <Cell w={W.rate} right>
          Rate
        </Cell>
        <Cell w={W.bal} right>
          Balance
        </Cell>
      </View>
      {day.rows.map((r, i) => (
        <View key={r.vehicle.id} style={s.tr} wrap={false}>
          <Cell w={W.n}>{i + 1}</Cell>
          <Cell w={W.car} bold>
            {r.vehicle.displayName}
          </Cell>
          <Cell w={W.client}>{r.booking ? `${r.booking.clientName ?? "—"}` : r.block ? BLOCK_KIND_LABELS[r.block.kind] : "—"}</Cell>
          <Cell w={W.dest}>{r.booking?.destination ?? r.block?.reason ?? ""}</Cell>
          <Cell w={W.status}>{`${r.statuses.map((x) => DAY_STATUS_LABELS[x]).join(", ")}${r.overdue ? " · OVERDUE" : ""}`}</Cell>
          <Cell w={W.moves} lines={2}>
            {r.events.map(chip).join("   ")}
          </Cell>
          <Cell w={W.rate} right>
            {r.vehicle.dailyRateDisplay ? fmtPeso(r.vehicle.dailyRateDisplay) : ""}
          </Cell>
          <Cell w={W.bal} right>
            {r.booking?.balance !== undefined ? fmtPeso(r.booking.balance) : ""}
          </Cell>
        </View>
      ))}

      <View style={s.cols}>
        <View style={s.col}>
          <Text style={s.h2}>With Driver trips</Text>
          {day.withDriver.length === 0 ? <Text style={s.muted}>None</Text> : null}
          {day.withDriver.map((t) => (
            <Text key={t.bookingId}>
              {clip(`${hm(t.startAt)}–${hm(t.endAt)} · ${t.vehicle?.displayName ?? "—"} · ${t.driverName ?? "Waiting driver…"} · ${t.clientName ?? "—"}`, 330)}
            </Text>
          ))}
          <Text style={s.h2}>Special instructions</Text>
          {day.instructions.length === 0 ? <Text style={s.muted}>None</Text> : null}
          {day.instructions.map((x, i) => (
            <Text key={`${x.bookingId}-${i}`}>
              <Text style={{ fontWeight: 600 }}>{x.kind === "NOTE" ? "Note" : x.kind}</Text>{" "}
              {clip(`${x.vehicle?.displayName ?? x.number}${x.at ? ` ${hm(x.at)}` : ""}: ${x.text}`, 310, 2)}
            </Text>
          ))}
          <Text style={s.h2}>On duty</Text>
          {roster.today.length + roster.carried.length === 0 ? <Text style={s.muted}>No shifts set</Text> : null}
          {roster.carried.map((e) => (
            <Text key={e.id} style={s.muted}>
              {e.userName} · {names.get(e.templateId)} ({DUTY_LABELS[e.duty]}, from the night before)
            </Text>
          ))}
          {roster.today.map((e) => (
            <Text key={e.id}>
              {e.userName} · {names.get(e.templateId)} · {DUTY_LABELS[e.duty]}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1.4 }}>
          <Text style={s.h2}>Look ahead (5 days)</Text>
          <View style={s.th}>
            <Cell w={110}>Car</Cell>
            {lookAhead[0]?.days.map((x) => (
              <Cell key={x.date} w={64}>
                {`${weekdayShort(x.date)} ${x.date.slice(5)}`}
              </Cell>
            ))}
          </View>
          {lookAhead
            .filter((r) => r.days.some((x) => x.events.length))
            .map((r) => (
              <View key={r.vehicle.id} style={s.trTight} wrap={false}>
                <Cell w={110}>{r.vehicle.displayName}</Cell>
                {r.days.map((x) => (
                  <Cell key={x.date} w={64} lines={2}>
                    {x.events.map((e) => `${[e.kind, ...e.codes].join(" ")} ${hm(e.at)}`).join(" ")}
                  </Cell>
                ))}
              </View>
            ))}
        </View>
      </View>

      <View style={s.footer} fixed>
        <Text>OUT release · IN return · EXT extension · FD delivery · PU pick-up · WD with driver · PR pending reservation · [time] actual · Balance = charges − payments</Text>
        <Text>{day.date}</Text>
      </View>
    </Page>
  );
}

export async function renderBoardPdf(days: BoardPdfDay[], asOf: Date, business: string): Promise<Buffer> {
  return renderToBuffer(
    <Document title={`Daily Movement ${days[0]?.day.date ?? ""}`} author={business}>
      {days.map((d) => (
        <DayPage key={d.day.date} d={d} asOf={asOf} business={business} />
      ))}
    </Document>,
  );
}

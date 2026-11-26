/**
 * What a client sees of a quotation: the view model shared by the PDF, the
 * share page and the copy text. Pure. Built from the stored row only
 * (inputs, result, snapshot), so issued quotations never change when rates,
 * clients or vehicles change. Carries no internal fields (no emails, notes,
 * rate card id).
 */
import { BODY_TYPE_LABELS, CATEGORY_LABELS, SERVICE_LABELS, type BodyType, type Category, type Service } from "@/lib/pricing";
import { manilaParts } from "@/lib/time";
import type { QuoteResult } from "./engine";
import type { QuoteForm } from "./schema";

export type Business = { name: string; address: string; mobile: string; landline: string; email: string };

/** Names frozen when the quotation is saved/issued. */
export type QuoteSnapshot = {
  clientName: string | null;
  clientFbName: string | null;
  vehicleName: string | null;
  consultantName: string | null;
};

export type EffectiveStatus = "draft" | "issued" | "accepted" | "expired" | "lost" | "cancelled";

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  accepted: "Accepted",
  expired: "Expired",
  lost: "Lost",
  cancelled: "Cancelled",
};

/** `expired` is computed on read (issued and past `valid_until`) and also stored by the nightly job (Phase 3). */
export function effectiveStatus(
  row: { status: EffectiveStatus; validUntil: Date | null },
  now: Date = new Date(),
): EffectiveStatus {
  if (row.status === "issued" && row.validUntil && row.validUntil.getTime() < now.getTime()) return "expired";
  return row.status;
}

export type QuoteDoc = {
  number: string | null;
  kind: "quick" | "formal";
  service: Service;
  status: EffectiveStatus;
  issuedAt: Date | null;
  validUntil: Date | null;
  startAt: Date;
  endAt: Date;
  business: Business;
  consultantName: string | null;
  clientName: string | null;
  clientFbName: string | null;
  /** "Wigo (Compact)" with a vehicle, else "Sedan Primo" / "Compact". */
  vehicleLabel: string;
  bodyLabel: string;
  categoryLabel: string | null;
  form: QuoteForm;
  result: QuoteResult;
};

export function bodyLabel(bodyType: BodyType, category: Category | null): string {
  return category ? `${BODY_TYPE_LABELS[bodyType]} ${CATEGORY_LABELS[category]}` : BODY_TYPE_LABELS[bodyType];
}

export function vehicleLabel(vehicleName: string | null, bodyType: BodyType, category: Category | null): string {
  const body = bodyLabel(bodyType, category);
  return vehicleName ? `${vehicleName} (${body})` : body;
}

// ---------------------------------------------------------------------------
// Formatting (deterministic: same text on server, client and in tests)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `11:30 AM` (Manila) */
export function fmtTime(d: Date): string {
  const p = manilaParts(d);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** `Nov 22, 11:30 AM` */
export function fmtShortDateTime(d: Date): string {
  const p = manilaParts(d);
  return `${MONTHS[p.month - 1]} ${p.day}, ${fmtTime(d)}`;
}

/** `Nov 24, 2026` */
export function fmtDate(d: Date): string {
  const p = manilaParts(d);
  return `${MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
}

/** `Nov 24, 2026 11:30 AM` */
export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

const amountFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 158000 → `1,580.00`; -7900 → `-79.00` (no currency sign). */
export function fmtAmount(centavos: number): string {
  return `${centavos < 0 ? "-" : ""}${amountFmt.format(Math.abs(centavos) / 100)}`;
}

/** 158000 → `₱1,580.00`; -7900 → `-₱79.00`. */
export function fmtPeso(centavos: number): string {
  return `${centavos < 0 ? "-" : ""}₱${amountFmt.format(Math.abs(centavos) / 100)}`;
}

/** E.164 PH → `0919 073 7627` / `(082) 282-0843`. */
export function fmtPhone(e164: string): string {
  const local = e164.startsWith("+63") ? `0${e164.slice(3)}` : e164;
  if (/^09\d{9}$/.test(local)) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  if (/^0\d{9}$/.test(local)) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Days and hours text: `1 day`, `1 day (12 hours)`, `2 days + 8 hours`. */
export function durationText(doc: Pick<QuoteDoc, "result">): string {
  const r = doc.result;
  if (r.service === "self_drive") {
    const i = r.inputs;
    const base = i.hoursTier === 24 ? plural(i.days, "day") : `${plural(i.days, "day")} (${i.hoursTier} hours)`;
    return i.additionalHoursBlock ? `${base} + ${i.additionalHoursBlock} hours` : base;
  }
  const hours = r.contractMinutes / 60;
  return `${plural(r.billingDays, "day")} · ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours/day (${r.hoursTier}h package)`;
}

/** Line label as printed: the rental line carries the day count. */
export function printedLabel(line: { code: string; label: string; remark: string }, doc: Pick<QuoteDoc, "result">): string {
  if (line.code !== "rental" || line.remark.includes("flat rate")) return line.label;
  const days = doc.result.service === "self_drive" ? doc.result.inputs.days : doc.result.billingDays;
  return `${line.label} (${plural(days, "day")})`;
}

export type Totals = { label: string; amount: number; strong?: boolean }[];

/** Totals block under the lines, per service (quote-documents.md §2.8, §3.6). */
export function totalsFor(doc: Pick<QuoteDoc, "result">): Totals {
  const r = doc.result;
  if (r.service === "self_drive") {
    const out: Totals = [];
    if (r.discounts.length) out.push({ label: "Subtotal", amount: r.subtotal });
    out.push({ label: "Rental total", amount: r.total, strong: true });
    return out;
  }
  const out: Totals = [{ label: "Sub total", amount: r.subtotal }];
  if (r.terminalFees.rental) out.push({ label: "Terminal fee 3.5% (card)", amount: r.terminalFees.rental });
  if (r.terminalFees.reservation) out.push({ label: "Terminal fee 3.5% (reservation, card)", amount: r.terminalFees.reservation });
  if (r.corporateMarkup) out.push({ label: "Corporate mark-up", amount: r.corporateMarkup });
  out.push({ label: "Grand total", amount: r.grandTotal, strong: true });
  return out;
}

/** Self-Drive "Amounts payable" block (quote-documents.md §2.8). */
export function sdPayable(doc: Pick<QuoteDoc, "result">) {
  const r = doc.result;
  if (r.service !== "self_drive") return null;
  const p = r.payable;
  const rows: Totals = [
    { label: "Reservation fee (today)", amount: p.reservationFee },
    { label: "Delivery fee (today)", amount: p.deliveryFee },
  ];
  if (p.terminalFees.reservation) rows.push({ label: "Terminal fee, reservation (card)", amount: p.terminalFees.reservation });
  if (p.terminalFees.rental) rows.push({ label: "Terminal fee, rental (card)", amount: p.terminalFees.rental });
  if (p.terminalFees.deposit) rows.push({ label: "Terminal fee, deposit (card)", amount: p.terminalFees.deposit });
  rows.push({ label: "Balance on release", amount: p.balanceOnRelease });
  rows.push({ label: "Total contract value", amount: p.totalContractValue, strong: true });
  return rows;
}

/**
 * Plain text for Messenger / WhatsApp (Phase 1c brief §7). Amounts are
 * right-aligned in a monospace-friendly column.
 */
export function quoteText(doc: QuoteDoc): string {
  const r = doc.result;
  const head = `${doc.business.name} — ${doc.number ?? "ESTIMATE"}`;
  const sub = [SERVICE_LABELS[doc.service], doc.vehicleLabel, `${fmtShortDateTime(doc.startAt)} – ${fmtShortDateTime(doc.endAt)}`].join(" · ");

  const body: [number, string][] = [...r.lines, ...r.discounts].map((l) => [l.amount, printedLabel(l, doc)]);
  const after: [number, string][] = [];
  if (r.service === "self_drive") {
    after.push([r.total, "Rental total"]);
    if (r.payable.terminalFees.rental) after.push([r.payable.terminalFees.rental, "Terminal fee (card)"]);
    if (r.payable.deposit) after.push([r.payable.deposit, "Refundable deposit"]);
  } else {
    after.push([r.total, "Total"]);
    const fees = r.terminalFees.rental + r.terminalFees.reservation;
    if (fees) after.push([fees, "Terminal fee (card)"]);
    if (r.corporateMarkup) after.push([r.corporateMarkup, "Corporate mark-up"]);
    if (fees || r.corporateMarkup) after.push([r.grandTotal, "Grand total"]);
  }
  const width = Math.max(...[...body, ...after].map(([a]) => fmtAmount(a).length));
  const row = ([a, label]: [number, string]) => `${fmtAmount(a).padStart(width)}  ${label}`;

  const out = [head, sub, ...body.map(row), "-".repeat(width), ...after.map(row)];
  if (doc.validUntil) out.push(`Valid until ${fmtDateTime(doc.validUntil)}`);
  if (!doc.number) out.push("Estimate only. Rates are confirmed once a formal quotation is issued.");
  return out.join("\n");
}

/** `QTN-2026-929_Juan-Dela-Cruz.pdf` / `Estimate_2026-11-23_1030.pdf` (quote-documents.md §4). */
export function pdfFileName(doc: Pick<QuoteDoc, "number" | "clientName" | "issuedAt">, now: Date = new Date()): string {
  if (!doc.number) {
    const p = manilaParts(doc.issuedAt ?? now);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Estimate_${p.year}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}${pad(p.minute)}.pdf`;
  }
  const slug = (doc.clientName ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${doc.number}_${slug}.pdf` : `${doc.number}.pdf`;
}

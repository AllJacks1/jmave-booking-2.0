/**
 * Quotation result → `booking_charges` rows (source `quote`). Pure.
 *
 * Charges add up to what the client owes for the rental, excluding the
 * security deposit (the deposit is tracked in the payments ledger as
 * `deposit` / `deposit_refund`, §3):
 *   Self-Drive:  rental total (lines + discounts) + card terminal fees
 *   With Driver: grand total (lines + discounts + terminal fees + corporate mark-up)
 */
import type { QuoteResult } from "@/lib/quotes/engine";
import type { ChargeKind, ChargeSource } from "./constants";

export type ChargeDraft = {
  kind: ChargeKind;
  code: string | null;
  label: string;
  amountCentavos: number;
  source: ChargeSource;
  sortOrder: number;
};

export function chargesFromQuoteResult(result: QuoteResult): ChargeDraft[] {
  const rows: Omit<ChargeDraft, "sortOrder" | "source" | "kind">[] = [];
  const lineLabel = (l: { label: string; remark: string }) => (l.remark ? `${l.label} · ${l.remark}` : l.label);
  for (const l of [...result.lines, ...result.discounts]) {
    if (l.amount !== 0) rows.push({ code: l.code, label: lineLabel(l), amountCentavos: l.amount });
  }
  if (result.service === "self_drive") {
    const f = result.payable.terminalFees;
    if (f.rental) rows.push({ code: "terminal_fee_rental", label: "Terminal fee, rental (card)", amountCentavos: f.rental });
    if (f.reservation) rows.push({ code: "terminal_fee_reservation", label: "Terminal fee, reservation (card)", amountCentavos: f.reservation });
    if (f.deposit) rows.push({ code: "terminal_fee_deposit", label: "Terminal fee, deposit (card)", amountCentavos: f.deposit });
  } else {
    if (result.terminalFees.rental) rows.push({ code: "terminal_fee_rental", label: "Terminal fee (card)", amountCentavos: result.terminalFees.rental });
    if (result.terminalFees.reservation) rows.push({ code: "terminal_fee_reservation", label: "Terminal fee, reservation (card)", amountCentavos: result.terminalFees.reservation });
    if (result.corporateMarkup) rows.push({ code: "corporate_markup", label: "Corporate mark-up", amountCentavos: result.corporateMarkup });
  }
  return rows.map((r, i) => ({ ...r, kind: "quoted", source: "quote", sortOrder: i }));
}

/** Security deposit the quotation asks for (Self-Drive only), centavos. */
export function quotedDeposit(result: QuoteResult): number {
  return result.service === "self_drive" ? result.payable.deposit : 0;
}

/** Reservation fee the quotation asks for, centavos. */
export function quotedReservationFee(result: QuoteResult): number {
  return result.payable.reservationFee;
}

/** `quotations.imported_data` written by the Phase 2a history import. */
export type ImportedQuotationData = {
  source: string;
  status: string | null;
  lines: { label: string; amount: number }[];
  total: number | null;
  reservationFee: number;
  deposit: number;
  paymentMethod: string;
  vehicleText: string | null;
  category: string | null;
  destination: string | null;
  sales: string | null;
};

/** Logged lines (+ a balancing line to the logged total) as quote charges. */
export function chargesFromImported(data: ImportedQuotationData | null): ChargeDraft[] {
  if (!data) return [];
  const rows = data.lines.filter((l) => l.amount !== 0).map((l) => ({ label: l.label, amount: l.amount }));
  const sum = rows.reduce((s, l) => s + l.amount, 0);
  if (data.total !== null && data.total !== sum) rows.push({ label: "Difference to logged total", amount: data.total - sum });
  return rows.map((l, i) => ({ kind: "quoted", code: null, label: l.label, amountCentavos: l.amount, source: "quote", sortOrder: i }));
}

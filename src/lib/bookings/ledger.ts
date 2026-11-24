/**
 * Payments ledger maths (docs/reference/bookings-and-movement.md §3). Pure; centavos.
 *
 *   charges      = sum(booking_charges)
 *   paid_in      = sum(payments in, not voided, excluding deposit)
 *   paid_out     = sum(payments out, not voided, excluding deposit_refund)
 *   balance      = charges − paid_in + paid_out
 *   deposit_held = deposit in − deposit_refund out
 */
import type { PaymentDirection, PaymentType } from "./constants";

export type LedgerCharge = { amountCentavos: number };
export type LedgerPayment = {
  type: PaymentType;
  direction: PaymentDirection;
  amountCentavos: number;
  voidedAt: Date | string | null;
};

export type Ledger = {
  charges: number;
  paidIn: number;
  paidOut: number;
  balance: number;
  depositIn: number;
  depositOut: number;
  depositHeld: number;
  reservationFeePaid: number;
};

export function computeLedger(charges: readonly LedgerCharge[], payments: readonly LedgerPayment[]): Ledger {
  const total = charges.reduce((s, c) => s + c.amountCentavos, 0);
  let paidIn = 0;
  let paidOut = 0;
  let depositIn = 0;
  let depositOut = 0;
  let reservationFeePaid = 0;
  for (const p of payments) {
    if (p.voidedAt) continue;
    if (p.type === "deposit") {
      depositIn += p.direction === "in" ? p.amountCentavos : -p.amountCentavos;
      continue;
    }
    if (p.type === "deposit_refund") {
      depositOut += p.direction === "out" ? p.amountCentavos : -p.amountCentavos;
      continue;
    }
    if (p.direction === "in") paidIn += p.amountCentavos;
    else paidOut += p.amountCentavos;
    if (p.type === "reservation_fee" && p.direction === "in") reservationFeePaid += p.amountCentavos;
  }
  return {
    charges: total,
    paidIn,
    paidOut,
    balance: total - paidIn + paidOut,
    depositIn,
    depositOut,
    depositHeld: depositIn - depositOut,
    reservationFeePaid,
  };
}

export function hasReservationFee(payments: readonly LedgerPayment[]): boolean {
  return payments.some((p) => !p.voidedAt && p.type === "reservation_fee" && p.direction === "in" && p.amountCentavos > 0);
}

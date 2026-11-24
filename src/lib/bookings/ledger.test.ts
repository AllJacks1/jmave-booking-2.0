import { describe, expect, it } from "vitest";
import { computeLedger, hasReservationFee, type LedgerPayment } from "./ledger";

const p = (type: LedgerPayment["type"], direction: LedgerPayment["direction"], pesos: number, voided = false): LedgerPayment => ({
  type,
  direction,
  amountCentavos: Math.round(pesos * 100),
  voidedAt: voided ? new Date() : null,
});

describe("payments ledger (§3)", () => {
  it("the real example: balance 0, deposit held 2,000", () => {
    // Rental total 2,191 + deposit 2,000. 990 GCash before release.
    // 3,500 cash at turnover = 2,000 deposit + 1,500 rental. 299 change given back.
    const charges = [{ amountCentavos: 219100 }];
    const payments = [
      p("reservation_fee", "in", 500),
      p("delivery_fee", "in", 490),
      p("deposit", "in", 2000),
      p("rental", "in", 1500),
      p("change_given", "out", 299),
    ];
    const l = computeLedger(charges, payments);
    expect(l.balance).toBe(0);
    expect(l.depositHeld).toBe(200000);
    expect(l.paidIn).toBe(249000);
    expect(l.paidOut).toBe(29900);
    expect(l.reservationFeePaid).toBe(50000);
  });

  it("deposit refund brings deposit held to zero", () => {
    const l = computeLedger([{ amountCentavos: 100000 }], [p("rental", "in", 1000), p("deposit", "in", 2000), p("deposit_refund", "out", 2000)]);
    expect(l).toMatchObject({ balance: 0, depositHeld: 0, depositIn: 200000, depositOut: 200000 });
  });

  it("voided entries are ignored", () => {
    const l = computeLedger([{ amountCentavos: 100000 }], [p("rental", "in", 1000, true), p("deposit", "in", 2000, true)]);
    expect(l).toMatchObject({ balance: 100000, depositHeld: 0, paidIn: 0 });
    expect(hasReservationFee([p("reservation_fee", "in", 500, true)])).toBe(false);
    expect(hasReservationFee([p("reservation_fee", "in", 500)])).toBe(true);
  });

  it("negative charges (discounts) and overpayment give a negative balance", () => {
    const l = computeLedger([{ amountCentavos: 300000 }, { amountCentavos: -50000 }], [p("rental", "in", 3000)]);
    expect(l.charges).toBe(250000);
    expect(l.balance).toBe(-50000);
  });

  it("other in/out count in paid in/out", () => {
    const l = computeLedger([], [p("other", "in", 100), p("other", "out", 40)]);
    expect(l).toMatchObject({ paidIn: 10000, paidOut: 4000, balance: -6000 });
  });
});

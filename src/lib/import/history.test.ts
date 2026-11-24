import { describe, expect, it } from "vitest";
import { decideHistory, historyCharges, matchVehicleText } from "./history-plan";
import { paymentMethodFromText, saneDate } from "./history";
import type { HistoryImport } from "./types";

const NOW = new Date("2026-11-24T02:00:00Z");

function row(p: Partial<HistoryImport>): HistoryImport {
  return {
    tab: "Rental Log",
    row: 2,
    number: "QTN-2026-001",
    service: "self_drive",
    status: null,
    bookedOn: null,
    startAt: "2026-12-01T01:00:00.000Z",
    endAt: "2026-12-02T01:00:00.000Z",
    clientName: "Test Person",
    vehicleText: null,
    categoryText: null,
    destination: null,
    sales: null,
    lines: [],
    total: null,
    reservationFee: 0,
    deposit: 0,
    paymentMethod: "cash",
    ...p,
  };
}

describe("history import helpers", () => {
  it("matches a car by the plate inside the log text, ignoring spaces", () => {
    const fleet = [
      { plate: "LAS 2163", displayName: "Vios Silver 2026 AT" },
      { plate: "NHS 5905", displayName: "Vios Red AT" },
      { plate: null, displayName: "Hired Van" },
    ];
    expect(matchVehicleText("Vios Silver 2026 AT - LAS 2163", fleet)?.plate).toBe("LAS 2163");
    expect(matchVehicleText("vios silver - las2163", fleet)?.plate).toBe("LAS 2163");
    expect(matchVehicleText("Hired Van", fleet)?.displayName).toBe("Hired Van");
    expect(matchVehicleText("Vios Red AT - NHS 5909", fleet)).toBeNull();
    expect(matchVehicleText("-", fleet)).toBeNull();
    expect(matchVehicleText(null, fleet)).toBeNull();
  });

  it("maps statuses per import-map.md", () => {
    const past = { startAt: "2026-01-01T01:00:00.000Z", endAt: "2026-01-02T01:00:00.000Z" };
    expect(decideHistory(row({ status: "QUOTED", ...past }), NOW)).toMatchObject({ quotationStatus: "expired", booking: null });
    expect(decideHistory(row({ status: "QUOTED" }), NOW)).toMatchObject({ quotationStatus: "issued", booking: null });
    expect(decideHistory(row({ status: null }), NOW)).toMatchObject({ quotationStatus: "issued", booking: null });
    expect(decideHistory(row({ status: "BOOKED" }), NOW)).toMatchObject({ quotationStatus: "accepted", booking: "confirmed" });
    expect(decideHistory(row({ status: "BOOKED", ...past }), NOW)).toMatchObject({ quotationStatus: "accepted", booking: "closed" });
    expect(decideHistory(row({ status: "COMPLETED" }), NOW)).toMatchObject({ quotationStatus: "accepted", booking: "closed" });
    expect(decideHistory(row({ status: "BOOKED", startAt: null, endAt: null }), NOW)).toMatchObject({ booking: null });
    // With Driver rows never become bookings.
    expect(decideHistory(row({ service: "with_driver", status: null }), NOW)).toMatchObject({ quotationStatus: "issued", booking: null });
  });

  it("charges reconcile to the logged total", () => {
    const h = row({ lines: [{ label: "Rental rate", amount: 150000 }, { label: "Less discount", amount: -10000 }], total: 145000 });
    const c = historyCharges(h);
    expect(c.reduce((s, x) => s + x.amount, 0)).toBe(145000);
    expect(c.at(-1)).toEqual({ label: "Difference to logged total", amount: 5000 });
    expect(historyCharges(row({ lines: [{ label: "Rental rate", amount: 100 }], total: 100 }))).toHaveLength(1);
  });

  it("payment modes and date sanity", () => {
    expect(paymentMethodFromText("GCash")).toBe("gcash");
    expect(paymentMethodFromText("Credit Card")).toBe("card");
    expect(paymentMethodFromText("BPI transfer")).toBe("bank");
    expect(paymentMethodFromText("CASH")).toBe("cash");
    expect(paymentMethodFromText(null)).toBe("other");
    expect(saneDate("2026-03-21")).toBe("2026-03-21");
    expect(saneDate("20263-03-21")).toBeNull();
    expect(saneDate("0206-04-26")).toBeNull();
  });
});

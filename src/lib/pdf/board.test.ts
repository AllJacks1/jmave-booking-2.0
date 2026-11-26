import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveBoardDay, deriveLookAhead, type BoardBooking, type BoardInput } from "@/lib/movements";
import { manilaToUtc } from "@/lib/time";
import { renderBoardPdf, type BoardPdfDay } from "./board";

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

/** 20 invented vehicles, each with a rental crossing the day. */
function input(): BoardInput {
  const vehicles = Array.from({ length: 20 }, (_, i) => ({
    id: `v${i}`,
    displayName: `Testcar ${i} Silver AT`,
    plate: `TST ${1000 + i}`,
    dailyRateDisplay: 179_000,
  }));
  const bookings: BoardBooking[] = vehicles.map((v, i) => ({
    id: `b${i}`,
    number: `QTN-2026-${900 + i}`,
    vehicleId: v.id,
    service: i % 4 === 0 ? "with_driver" : "self_drive",
    status: i % 3 === 0 ? "released" : "confirmed",
    startAt: manilaToUtc("2026-12-10", `${String(6 + (i % 12)).padStart(2, "0")}:00`),
    endAt: manilaToUtc("2026-12-11", "18:00"),
    clientName: `Maximiliano Bartolomeo Fernandez-Castellanos ${i}`,
    destination: "Samal Island",
    deliveryAddress: i % 2 ? "Lanang Business Park, Davao City" : null,
    pickupAddress: null,
    driverName: null,
    notes: i === 3 ? "Child seat requested" : null,
    showNotesOnBoard: i === 3,
    release: null,
    return: null,
    extensions: [],
    balance: 150_000,
    depositHeld: 200_000,
  }));
  return { vehicles, bookings, blocks: [], now: manilaToUtc("2026-12-10", "08:00") };
}

function day(date: string): BoardPdfDay {
  const i = input();
  return { day: deriveBoardDay(i, date), lookAhead: deriveLookAhead(i, date), roster: { templates: [], today: [], carried: [] } };
}

describe("board PDF", () => {
  it("one A4 landscape page per day, 20 vehicles", async () => {
    const buf = await renderBoardPdf([day("2026-12-10")], manilaToUtc("2026-12-10", "08:00"), "J-MaVe Cars");
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf);
    expect(isPdf(buf)).toBe(true);
    expect(pages(buf)).toBe(1);
    expect(buf.toString("latin1")).toMatch(/\/MediaBox \[0 0 841\.89\d* 595\.28\d*\]/);
  });

  it("several days → several pages", async () => {
    const buf = await renderBoardPdf([day("2026-12-10"), day("2026-12-11"), day("2026-12-12")], new Date(), "J-MaVe Cars");
    expect(pages(buf)).toBe(3);
  });
});

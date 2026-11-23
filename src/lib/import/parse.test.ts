import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bookingWorkbook, dmsWorkbook } from "../../../tests/fixtures/workbooks";
import { EXPECTED_RATE_CARD_V1 } from "@/lib/pricing/expected-v1";
import { ImportFileError, parseWorkbookBuffer } from "./parse";
import type { BookingWorkbookPayload, DmsWorkbookPayload } from "./types";
import { dateFromCell, normaliseBodyType, normaliseFuelType, normaliseValue } from "./workbook";

async function booking(opts?: Parameters<typeof bookingWorkbook>[0]) {
  return (await parseWorkbookBuffer(await bookingWorkbook(opts))) as BookingWorkbookPayload;
}

describe("workbook helpers", () => {
  it.each([
    ["Pick up", "pickup"],
    ["Pick-up", "pickup"],
    ["PICK UP", "pickup"],
    ["SEDAN", "sedan"],
    ["Wagpn", "wagon"],
    ["VAN", "van"],
    ["MGZ", null],
    ["Hovercraft", null],
  ])("body type %s → %s", (raw, expected) => expect(normaliseBodyType(raw)).toBe(expected));

  it("fuel types", () => {
    expect(normaliseFuelType("Unleaded")).toBe("gasoline");
    expect(normaliseFuelType("Premium")).toBe("premium");
    expect(normaliseFuelType("Diesel")).toBe("diesel");
    expect(normaliseFuelType("Plasma")).toBeNull();
  });

  it.each([
    [46349, "2026-11-23"],
    ["3/14/1990", "1990-03-14"],
    ["14/03/1990", "1990-03-14"],
    ["03-14-90", "1990-03-14"],
    ["March 14, 1990", "1990-03-14"],
    ["Mar.14,1990", "1990-03-14"],
    ["14 Mar 1990", "1990-03-14"],
    ["2026-11-23", "2026-11-23"],
    ["Aug 1-2, 2025", null],
    ["2/30/2026", null],
  ] as const)("date %j → %j", (v, expected) => expect(dateFromCell(v)).toBe(expected));

  it("cached formula values; errors become null", () => {
    expect(normaliseValue({ formula: "A1", result: 5 } as ExcelJS.CellValue)).toBe(5);
    expect(normaliseValue({ formula: "A1", result: { error: "#N/A" } } as ExcelJS.CellValue)).toBeNull();
    expect(normaliseValue({ richText: [{ text: "a" }, { text: "b" }] } as ExcelJS.CellValue)).toBe("ab");
    expect(normaliseValue("   ")).toBeNull();
  });
});

describe("parse booking workbook (invented data)", () => {
  it("rate card v1 equals pricing.md: zero mismatches", async () => {
    const p = await booking();
    const v1 = p.rateCards.find((c) => c.version === 1)!;
    expect(v1.status).toBe("active");
    expect(v1.data).toEqual(EXPECTED_RATE_CARD_V1);
    expect(p.warnings.filter((w) => w.level === "mismatch")).toEqual([]);
    expect(p.warnings.some((w) => w.section === "rate_cards" && /van.*PLAN Q7/.test(w.message))).toBe(true);
    expect(p.warnings.some((w) => /MGZ/.test(w.message))).toBe(true);
  });

  it("v2 draft takes Self-Drive from QP FORMULA and With Driver from v1", async () => {
    const p = await booking();
    const v2 = p.rateCards.find((c) => c.version === 2)!;
    expect(v2.status).toBe("draft");
    expect(v2.data.selfDrive.daily.compact.h24).toBe(149900);
    expect(v2.data.withDriver).toEqual(EXPECTED_RATE_CARD_V1.withDriver);
  });

  it("a changed rate cell is a self-check mismatch", async () => {
    const p = await booking({ tamperCompact24h: 1600 });
    const m = p.warnings.filter((w) => w.level === "mismatch");
    expect(m).toHaveLength(1);
    expect(m[0].message).toContain("selfDrive.daily.compact.h24");
  });

  it("fleet: SPECS rows until the first blank row, Back bone operators and extras", async () => {
    const p = await booking();
    expect(p.fleet.map((v) => v.key)).toEqual(["TST 1001", "TST 2002", "TST 3003", "TST 4004"]);
    const [testcar, bigcar, odd, van] = p.fleet;
    expect(testcar).toMatchObject({ bodyType: "sedan", fuelType: "gasoline", tankCapacityL: 42, engine: "1.3", operatorName: null });
    // Plate missing in SPECS, taken from Back bone by car name.
    expect(bigcar).toMatchObject({ plate: "TST 2002", operatorName: "Operator Person", tankCapacityL: 80 });
    expect(odd).toMatchObject({ bodyType: null, fuelType: null });
    expect(van).toMatchObject({ displayName: "Onlyhere Van TST 4004", bodyType: "van" });
    const msgs = p.warnings.filter((w) => w.section === "fleet").map((w) => w.message);
    expect(msgs.some((m) => m.includes('Unknown body type "Hovercraft"'))).toBe(true);
    expect(msgs.some((m) => m.includes("not in SPECS"))).toBe(true);
  });

  it("clients: grouped by phone/email, latest value wins, first rental from BOOKED/COMPLETED", async () => {
    const p = await booking();
    const byName = Object.fromEntries(p.clients.map((c) => [c.fullName, c]));
    expect(Object.keys(byName).sort()).toEqual(["Ana Testcase", "Ben Sample", "Cora Nocontact", "Dan Example", "Eve Corp"]);

    const ana = byName["Ana Testcase"];
    expect(ana.key).toBe("phone:+639170000001");
    expect(ana.rowCount).toBe(3); // two Rental Log rows + one WD row
    expect(ana.address).toBe("New Street 2");
    expect(ana.email).toBe("ana@example.test");
    expect(ana.birthday).toBe("1990-03-14");
    expect(ana.firstRentalAt).toBe("2026-02-03T04:00:00.000Z"); // Feb 3 12:00 Manila (BOOKED row)

    const ben = byName["Ben Sample"];
    expect(ben.key).toBe("email:ben@example.test");
    expect(ben.otherContacts).toEqual(["44 20 7946 0000"]);
    expect(ben.firstRentalAt).not.toBeNull();

    expect(byName["Cora Nocontact"].key).toBe("name:cora nocontact|cora fb");
    expect(byName["Cora Nocontact"].firstRentalAt).toBeNull(); // QUOTED only
    expect(byName["Eve Corp"].clientType).toBe("corporate");
    expect(byName["Dan Example"].birthday).toBeNull();

    const msgs = p.warnings.filter((w) => w.section === "clients").map((w) => w.message);
    expect(msgs).toContain("No client name; row skipped.");
    expect(msgs.some((m) => m.startsWith("Birthday"))).toBe(true);
  });

  it("sequences: highest number per year", async () => {
    const p = await booking();
    expect(p.sequences.map((s) => [s.key, s.value])).toEqual([
      ["QTN-2025", 777],
      ["QTN-2026", 109],
      ["QTN-WD2026", 12],
    ]);
  });
});

describe("parse DMS workbook", () => {
  it("blacklist rows: names, aliases, FB name, reason joined", async () => {
    const p = (await parseWorkbookBuffer(await dmsWorkbook())) as DmsWorkbookPayload;
    expect(p.kind).toBe("dms_workbook");
    expect(p.blacklist).toHaveLength(3);
    expect(p.blacklist[0]).toMatchObject({ fullName: "Ana Testcase", phone: "+639170000001", reason: "Unpaid balance" });
    expect(p.blacklist[1]).toMatchObject({
      fullName: "Zed Unknown",
      aliases: ["Zed U."],
      fbName: "Zed FB",
      phone: "+639170000099",
      reason: "Damaged car — Called twice — No ID",
    });
    expect(p.blacklist[2]).toMatchObject({ fullName: "Cora Nocontact", phone: null });
  });
});

describe("bad files", () => {
  it("rejects a non-workbook and an unrelated workbook", async () => {
    await expect(parseWorkbookBuffer(Buffer.from("not a zip"))).rejects.toThrow(ImportFileError);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    await expect(parseWorkbookBuffer(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow(/neither the booking workbook/);
  });
});

describe("contactless rows", () => {
  it("join the single client with the same name + FB name", async () => {
    const p = await booking({
      extraRentalRows: [{ A: "QTN-2026-110", B: new Date(Date.UTC(2026, 1, 9)), G: "Ana Testcase", H: "Ana T.", AM: "QUOTED" }],
    });
    const anas = p.clients.filter((c) => c.fullName === "Ana Testcase");
    expect(anas).toHaveLength(1);
    expect(anas[0].rowCount).toBe(4);
    expect(p.warnings.some((w) => w.level === "info" && /joined/.test(w.message))).toBe(true);
  });
});

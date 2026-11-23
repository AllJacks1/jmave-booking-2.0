/**
 * Money is integer centavos everywhere (₱1,580.00 = 158000).
 * Format only at the edge.
 */

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 158000 → "₱1,580.00" */
export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  return `${sign}₱${pesoFormatter.format(Math.abs(centavos) / 100)}`;
}

/** "1,580.50" | "1580.5" | 1580.5 → 158050. Returns null for invalid input. */
export function parsePesoToCentavos(input: string | number): number | null {
  const s = typeof input === "number" ? String(input) : input.replace(/[₱,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return s.startsWith("-") ? -value : value;
}

/** 158050 → "1580.50" (for form inputs). */
export function centavosToInput(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * Money from a spreadsheet cell: numbers or text like `₱1,580.00`.
 * Returns null for blanks and non-numbers. Rounds to the centavo.
 */
export function centavosFromCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  const s = String(value).replace(/[₱,\s]|PHP|Php/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

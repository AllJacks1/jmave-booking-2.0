/** Fuel gauge text: 8 → "Full (8/8)", 0 → "Empty (0/8)", 6 → "6/8". Pure. */
export function fuelText(eighths: number | null | undefined): string {
  if (eighths === null || eighths === undefined) return "—";
  return eighths === 8 ? "Full (8/8)" : eighths === 0 ? "Empty (0/8)" : `${eighths}/8`;
}

/**
 * Exact integer math for the engine. Fractions are carried as BigInt
 * numerator / denominator and rounded once, half away from zero, to the
 * centavo (pricing.md: "Round each line to the centavo (half-up)").
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function toBig(n: number): bigint {
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, got ${n}`);
  return BigInt(n);
}

/** round(Π numerators / Π denominators), half away from zero. Integers only. */
export function mulDiv(numerators: number[], denominators: number[] = [1]): number {
  let num = ONE;
  for (const n of numerators) num *= toBig(n);
  let den = ONE;
  for (const d of denominators) den *= toBig(d);
  if (den === ZERO) throw new Error("Division by zero");
  if (den < ZERO) {
    num = -num;
    den = -den;
  }
  const neg = num < ZERO;
  const abs = neg ? -num : num;
  const q = (abs * TWO + den) / (den * TWO);
  return Number(neg ? -q : q);
}

/** amount × basis points, rounded to the centavo. 361000 × 350 → 12635. */
export function applyBps(amount: number, bps: number): number {
  return mulDiv([amount, bps], [10_000]);
}

/** Distances: km (up to 3 decimals) → integer metres. */
export function kmToMetres(km: number): number {
  return Math.round(km * 1000);
}

/** km/L (up to 1 decimal) → integer tenths. */
export function toTenths(n: number): number {
  return Math.round(n * 10);
}

/** Round up to the next multiple of `step` (centavos). */
export function ceilTo(amount: number, step: number): number {
  return Math.ceil(amount / step) * step;
}

const plain = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const plain2 = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Remark number: 263000 → "2,630", 134750 → "1,347.50". */
export function remarkPesos(centavos: number): string {
  return centavos % 100 === 0 ? plain.format(centavos / 100) : plain2.format(centavos / 100);
}

/** Remark km/qty: 400 → "400", 12.5 → "12.5". */
export function remarkNumber(n: number): string {
  return plain.format(n);
}

/**
 * Philippine phone numbers. Stored as E.164 (`+639…`), displayed in local form.
 */

/**
 * Normalise a PH mobile or landline number to E.164.
 * Accepts `09xx…`, `9xx…`, `+639…`, `639…`, and landlines like `(082) 282-0843`.
 * Returns null when the input is not a plausible PH number.
 */
export function normalisePhPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  let national: string;
  if (hasPlus || digits.startsWith("63")) {
    if (!digits.startsWith("63")) return null;
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // Mobile: 9XX XXX XXXX (10 digits). Landline: area code + number, 8–9 digits.
  const isMobile = /^9\d{9}$/.test(national);
  const isLandline = /^[2-8]\d{7,8}$/.test(national);
  if (!isMobile && !isLandline) return null;
  return `+63${national}`;
}

/** Display an E.164 PH number in local form: `0919 073 7627`, `(082) 282-0843`. */
export function formatPhPhone(e164: string): string {
  if (!e164.startsWith("+63")) return e164;
  const n = e164.slice(3);
  if (/^9\d{9}$/.test(n)) {
    return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  // Metro Manila (02) uses 8-digit numbers; provinces use a 2-digit area code
  // and 7-digit numbers.
  if (n.startsWith("2") && n.length === 9) {
    return `(02) ${n.slice(1, 5)}-${n.slice(5)}`;
  }
  if (n.length === 9) {
    return `(0${n.slice(0, 2)}) ${n.slice(2, 5)}-${n.slice(5)}`;
  }
  return `0${n}`;
}

import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, "At most 128 characters");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Readable random temporary password (no 0/O/1/l/I). */
export function generateTemporaryPassword(length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 % 56 bias is negligible for a temporary password.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

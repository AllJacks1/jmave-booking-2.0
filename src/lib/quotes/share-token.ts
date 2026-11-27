import { randomBytes } from "node:crypto";

/** Share-link tokens (PLAN §4): 32 random bytes from the OS CSPRNG, base64url (43 chars, no padding). */
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

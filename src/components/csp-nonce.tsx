"use client";

import { setNonce } from "get-nonce";

/**
 * Hands the per-request CSP nonce to `get-nonce`, which Radix's scroll lock
 * (react-remove-scroll → react-style-singleton) uses for the `<style>` it
 * inserts while a dialog or sheet is open (Phase 5 CSP).
 */
export function CspNonce({ nonce }: { nonce?: string }) {
  if (nonce && typeof window !== "undefined") setNonce(nonce);
  return null;
}

/**
 * Outbox `rework_lead` sender (worker only, rework.md §2). Validates the
 * stored payload and hands the lead to the transport. Any 2xx is success
 * (rework.md §4.3); the response is stored on the outbox row.
 */
import type { OutboxRow } from "@/db/schema";
import { reworkOutboxPayloadSchema, type ReworkLead } from "./payload";

/** HTTP status and body (at most 2 KB), token removed. Stored in `outbox.response`. */
export type ReworkSendResult = { status: number; body: string };

export interface ReworkTransport {
  readonly name: string;
  /** Throws on a non-2xx response or a network error (the outbox retries). */
  send(lead: ReworkLead, idempotencyKey: string): Promise<ReworkSendResult>;
}

export const RESPONSE_BODY_MAX = 2048;

export function reworkHandler(transport: ReworkTransport) {
  return async (row: OutboxRow) => {
    const parsed = reworkOutboxPayloadSchema.safeParse(row.payload);
    if (!parsed.success) throw new Error(`Invalid Rework payload: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    return transport.send(parsed.data.lead, row.id);
  };
}

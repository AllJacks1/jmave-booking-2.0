/**
 * Email over the outbox (Phase 3). The web app only builds an `EmailPayload`
 * and enqueues it; the worker resolves attachments and calls a transport.
 */
import { z } from "zod";

export const emailAttachmentRefSchema = z.object({
  /** Rendered by the worker from the quotation's stored result. */
  kind: z.literal("quotation_pdf"),
  quotationId: z.uuid(),
  filename: z.string().min(1).max(200),
});

export const emailPayloadSchema = z.object({
  to: z.array(z.email()).min(1).max(5),
  replyTo: z.email().nullable().default(null),
  subject: z.string().min(1).max(300),
  text: z.string().max(20_000),
  html: z.string().max(60_000),
  attachments: z.array(emailAttachmentRefSchema).max(5).default([]),
});
export type EmailPayload = z.output<typeof emailPayloadSchema>;

export type EmailMessage = {
  from: string;
  to: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
};

/** What a successful send returns; stored in `outbox.response`. */
export type EmailSendResult = { provider: string; id: string | null };

export interface EmailTransport {
  readonly name: string;
  /** Throws on failure (the outbox retries). `idempotencyKey` = outbox row id. */
  send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>;
}

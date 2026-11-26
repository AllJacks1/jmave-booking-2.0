/**
 * Outbox `email` sender (worker only). Validates the payload, resolves the
 * attachments and hands the message to the transport.
 */
import type { OutboxRow } from "@/db/schema";
import { emailPayloadSchema, type EmailMessage, type EmailTransport } from "./types";

export type AttachmentResolver = (ref: { kind: "quotation_pdf"; quotationId: string; filename: string }) => Promise<Buffer>;

export function emailHandler(opts: { transport: EmailTransport; from: string | undefined; resolveAttachment: AttachmentResolver }) {
  return async (row: OutboxRow) => {
    if (!opts.from) throw new Error("EMAIL_FROM is not set.");
    const parsed = emailPayloadSchema.safeParse(row.payload);
    if (!parsed.success) throw new Error(`Invalid email payload: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    const p = parsed.data;
    const attachments: EmailMessage["attachments"] = [];
    for (const ref of p.attachments) {
      attachments.push({ filename: ref.filename, content: await opts.resolveAttachment(ref), contentType: "application/pdf" });
    }
    return opts.transport.send(
      { from: opts.from, to: p.to, replyTo: p.replyTo, subject: p.subject, text: p.text, html: p.html, attachments },
      row.id,
    );
  };
}

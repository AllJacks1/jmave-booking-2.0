/**
 * Resend transport (worker only). The web app never imports this file
 * (eslint `no-restricted-imports` + tests/integration/phase-3 check): web
 * requests only write outbox rows (PLAN §6.6).
 */
import type { EmailMessage, EmailSendResult, EmailTransport } from "@/lib/email/types";

const RESEND_URL = "https://api.resend.com/emails";

export function resendTransport(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    name: "resend",
    async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
      if (!apiKey) throw new Error("RESEND_API_KEY is not set.");
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `outbox-${idempotencyKey}`,
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString("base64"),
            content_type: a.contentType,
          })),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
      if (!res.ok) {
        throw new Error(`Resend ${res.status}${body?.name ? ` ${body.name}` : ""}: ${body?.message ?? res.statusText}`);
      }
      return { provider: "resend", id: body?.id ?? null };
    },
  };
}

/**
 * "Send by email" on an issued formal quotation (Phase 3 brief §9).
 *
 * The request only writes an outbox row (PLAN §6.6); the worker renders the
 * PDF from the stored result and sends it. Delivery status shows on the
 * quotation page.
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { outbox, user } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { quotationEmailContent } from "@/lib/email/quotation-email";
import type { EmailPayload } from "@/lib/email/types";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { pdfFileName } from "./document";
import { getDocById, shareLinkOpen } from "./service";

export const sendEmailSchema = z.object({
  id: z.uuid(),
  to: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  message: z.string().trim().max(4000, "At most 4,000 characters").default(""),
});
export type SendEmailInput = z.input<typeof sendEmailSchema>;

export const sendQuotationEmail = defineAction({
  permission: "quotes.manage",
  input: sendEmailSchema,
  handler: async (actor, { id, to, message }) => {
    const found = await getDocById(id);
    if (!found) throw new ActionError(404, "Quotation not found.");
    const { row, doc } = found;
    if (row.kind !== "formal" || !row.number || !row.issuedAt) throw new ActionError(409, "Only issued formal quotations can be emailed.");
    if (row.imported) throw new ActionError(409, "Imported quotations have no PDF to send.");
    if (doc.status !== "issued" && doc.status !== "accepted") {
      throw new ActionError(409, doc.status === "expired" ? "This quotation has expired. Revise it to send an updated one." : `A ${doc.status} quotation cannot be emailed.`);
    }
    const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    const shareUrl = appUrl && row.shareToken && shareLinkOpen(row) ? `${appUrl}/q/${row.shareToken}` : null;
    const content = quotationEmailContent(doc, { message, shareUrl });
    const replyTo = doc.business.email?.trim() || null;
    const payload: EmailPayload = {
      to: [to],
      replyTo: replyTo && z.email().safeParse(replyTo).success ? replyTo : null,
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments: [{ kind: "quotation_pdf", quotationId: row.id, filename: pdfFileName(doc) }],
    };
    return db.transaction(async (tx) => {
      const item = await enqueueOutbox(tx, { kind: "email", payload, entity: "quotation", entityId: row.id, createdBy: actor.id });
      await withAudit(actor, "quotation.email", "quotation", row.id, null, { outboxId: item.id, to, number: row.number }, tx);
      return { outboxId: item.id };
    });
  },
});

export type Delivery = {
  id: string;
  to: string[];
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  nextAttemptAt: Date;
  createdAt: Date;
  createdByName: string | null;
};

/** Emails queued for a quotation, newest first. */
export async function quotationDeliveries(quotationId: string): Promise<Delivery[]> {
  const rows = await db
    .select({ o: outbox, createdByName: user.displayName })
    .from(outbox)
    .leftJoin(user, eq(user.id, outbox.createdBy))
    .where(and(eq(outbox.entity, "quotation"), eq(outbox.entityId, quotationId), eq(outbox.kind, "email")))
    .orderBy(desc(outbox.createdAt))
    .limit(20);
  return rows.map(({ o, createdByName }) => ({
    id: o.id,
    to: (o.payload as { to?: string[] }).to ?? [],
    status: o.status,
    attempts: o.attempts,
    lastError: o.lastError,
    sentAt: o.sentAt,
    nextAttemptAt: o.nextAttemptAt,
    createdAt: o.createdAt,
    createdByName,
  }));
}

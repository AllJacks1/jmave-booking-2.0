/** Attachment resolver for outbox emails: renders the quotation PDF from its stored result. */
import { renderQuotationPdf } from "@/lib/pdf/quotation";
import { getDocById } from "@/lib/quotes/service";
import type { AttachmentResolver } from "@/lib/email/outbox-handler";

export const resolveAttachment: AttachmentResolver = async (ref) => {
  const found = await getDocById(ref.quotationId);
  if (!found || !found.row.issuedAt) throw new Error(`Quotation ${ref.quotationId} not found or not issued.`);
  return renderQuotationPdf(found.doc);
};

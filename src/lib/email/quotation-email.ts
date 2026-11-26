/**
 * The quotation email (Phase 3 brief §9). Pure: builds subject, text and
 * HTML from the quotation document; the PDF is attached by the worker.
 */
import { fmtDateTime, fmtPeso, type QuoteDoc } from "@/lib/quotes/document";
import { SERVICE_LABELS } from "@/lib/pricing/types";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function grandTotal(doc: QuoteDoc): number {
  return doc.result.service === "self_drive" ? doc.result.total : doc.result.grandTotal;
}

export function quotationEmailContent(doc: QuoteDoc, opts: { message: string; shareUrl: string | null }) {
  const number = doc.number ?? "Estimate";
  const subject = `${doc.business.name} — Quotation ${number}`;
  const greeting = doc.clientName ? `Hi ${doc.clientName},` : "Hi,";
  const facts = [
    `${SERVICE_LABELS[doc.service]} · ${doc.vehicleLabel}`,
    `${fmtDateTime(doc.startAt)} – ${fmtDateTime(doc.endAt)}`,
    `Total: ${fmtPeso(grandTotal(doc))}`,
    ...(doc.validUntil ? [`Valid until ${fmtDateTime(doc.validUntil)}`] : []),
  ];
  const message = opts.message.trim();
  const contacts = [doc.business.mobile, doc.business.landline, doc.business.email].filter(Boolean).join(" · ");
  const textParts = [
    greeting,
    "",
    ...(message ? [message, ""] : []),
    `Please find your quotation ${number} attached.`,
    "",
    ...facts,
    ...(opts.shareUrl ? ["", `View online: ${opts.shareUrl}`] : []),
    "",
    doc.consultantName ? `${doc.consultantName}\n${doc.business.name}` : doc.business.name,
    ...(contacts ? [contacts] : []),
  ];
  const p = (s: string) => `<p style="margin:0 0 12px">${escapeHtml(s).replace(/\n/g, "<br>")}</p>`;
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">`,
    p(greeting),
    ...(message ? [p(message)] : []),
    p(`Please find your quotation ${number} attached.`),
    `<p style="margin:0 0 12px">${facts.map(escapeHtml).join("<br>")}</p>`,
    ...(opts.shareUrl ? [`<p style="margin:0 0 12px"><a href="${escapeHtml(opts.shareUrl)}">View your quotation online</a></p>`] : []),
    p(doc.consultantName ? `${doc.consultantName}\n${doc.business.name}` : doc.business.name),
    ...(contacts ? [`<p style="margin:0;color:#555;font-size:12px">${escapeHtml(contacts)}</p>`] : []),
    `</div>`,
  ].join("");
  return { subject, text: textParts.join("\n"), html };
}

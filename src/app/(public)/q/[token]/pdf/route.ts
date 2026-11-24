import { NextResponse } from "next/server";
import { renderQuotationPdf } from "@/lib/pdf/quotation";
import { pdfResponse } from "@/lib/pdf/response";
import { pdfFileName } from "@/lib/quotes/document";
import { getByShareToken, shareLinkOpen } from "@/lib/quotes/service";

/** Public PDF via share token: `GET /q/[token]/pdf` (PLAN §6.5). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getByShareToken(token);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!shareLinkOpen(found.row)) return NextResponse.json({ error: "This quotation has expired." }, { status: 410 });
  return pdfResponse(await renderQuotationPdf(found.doc), pdfFileName(found.doc), "noindex, nofollow");
}

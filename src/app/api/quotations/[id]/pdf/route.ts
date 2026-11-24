import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { renderQuotationPdf } from "@/lib/pdf/quotation";
import { pdfResponse } from "@/lib/pdf/response";
import { can } from "@/lib/permissions";
import { pdfFileName } from "@/lib/quotes/document";
import { getDocById } from "@/lib/quotes/service";

/** Staff PDF: `GET /api/quotations/[id]/pdf` (PLAN §6.5). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.mustChangePassword || !can(user, "quotes.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const found = await getDocById(id);
  if (!found || !found.row.issuedAt) {
    return NextResponse.json({ error: "Not found, or not issued yet" }, { status: 404 });
  }
  return pdfResponse(await renderQuotationPdf(found.doc), pdfFileName(found.doc));
}

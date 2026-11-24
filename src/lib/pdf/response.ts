import "server-only";
import { NextResponse } from "next/server";

/** PDF download response; never cached, never indexed. */
export function pdfResponse(buf: Buffer, fileName: string, robots = "noindex") {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": robots,
    },
  });
}

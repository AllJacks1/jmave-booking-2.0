import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { MAX_IMPORT_BYTES, previewUpload } from "@/lib/import/service";
import { isSameOriginRequest } from "@/lib/security/origin";

// Parsing the booking workbook takes a few seconds and ~700 MB.
export const maxDuration = 120;

/** POST multipart `file` → parse, store a previewed run, return its id. Super Admin only. */
export async function POST(request: Request) {
  // CSRF (Phase 5): cookie-authenticated upload, so refuse cross-site posts.
  if (!isSameOriginRequest(request.headers, request.url)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "You are not signed in." }, { status: 401 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: `The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Upload a file in the `file` field." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await previewUpload(actor, file.name, bytes);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, runId: result.runId }, { status: result.status });
  }
  return NextResponse.json({ runId: result.runId, totals: result.summary.totals });
}

/** Read a small JSON body (public endpoints): null when too large or not JSON. */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

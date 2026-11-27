/**
 * Before/after diff for the audit viewer (Phase 5). Pure: no DB, no React.
 *
 * Flattens both sides to dot paths (`business.mobile`, `lines.2.amount`) and
 * reports each path that was added, removed or changed. Arrays are compared
 * by index; a leaf is anything that is not a plain object or array.
 */

export type DiffKind = "added" | "removed" | "changed" | "same";

export type DiffRow = {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
};

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === "object" && !(v instanceof Date);
}

/** `{a:{b:1}, c:[2]}` → Map { "a.b" → 1, "c.0" → 2 }. Empty containers are leaves. */
export function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (isContainer(value)) {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0) {
      out.set(prefix || "(value)", value);
      return out;
    }
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out.set(prefix || "(value)", value);
  return out;
}

function sameLeaf(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rows in a stable order: paths of `before` first (in their order), then
 * paths only in `after`. `includeSame` keeps unchanged paths (for "show all").
 */
export function diffJson(before: unknown, after: unknown, opts: { includeSame?: boolean } = {}): DiffRow[] {
  const a = before === null || before === undefined ? new Map<string, unknown>() : flatten(before);
  const b = after === null || after === undefined ? new Map<string, unknown>() : flatten(after);
  const rows: DiffRow[] = [];
  for (const [path, av] of a) {
    if (!b.has(path)) rows.push({ path, kind: "removed", before: av });
    else {
      const bv = b.get(path);
      if (sameLeaf(av, bv)) {
        if (opts.includeSame) rows.push({ path, kind: "same", before: av, after: bv });
      } else rows.push({ path, kind: "changed", before: av, after: bv });
    }
  }
  for (const [path, bv] of b) if (!a.has(path)) rows.push({ path, kind: "added", after: bv });
  return rows;
}

/** Short display text for one leaf value. */
export function formatLeaf(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

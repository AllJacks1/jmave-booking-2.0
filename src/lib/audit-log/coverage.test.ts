/**
 * Phase 5: every write path is audited (CLAUDE.md "Audit").
 *
 * Static check over `src/lib`: each `defineAction` runner must reach
 * `withAudit` — directly or through a helper that does (found to a fixpoint
 * across files) — unless it is listed below as read-only or exempt with a
 * reason. A new action that writes without an audit row fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Runners that do not need an audit row, with the reason. */
const EXEMPT: Record<string, string> = {
  availabilityAction: "read-only availability check",
  previewReturn: "read-only price preview",
  previewExtension: "read-only price preview",
  previewPrice: "read-only price preview",
  searchClientsForQuote: "read-only search",
  saveDraft: "autosave of an unissued draft; issuing writes the audited, priced result",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

type Segment = { file: string; name: string; body: string; isAction: boolean };

/** Split a file into top-level declarations (function or const), by line start. */
function segments(file: string, src: string): Segment[] {
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=)/gm;
  const marks: { name: string; at: number }[] = [];
  for (const m of src.matchAll(re)) marks.push({ name: m[1] ?? m[2], at: m.index });
  return marks.map((m, i) => {
    const body = src.slice(m.at, marks[i + 1]?.at ?? src.length);
    return { file, name: m.name, body, isAction: /^export\s+const\s+[A-Za-z0-9_]+\s*=\s*defineAction\(/.test(body) };
  });
}

const files = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))];
const all = files.flatMap((f) => segments(path.relative(ROOT, f), readFileSync(f, "utf8")));

function auditingNames(): Set<string> {
  const names = new Set<string>(["withAudit"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of all) {
      if (names.has(s.name) || s.isAction) continue;
      const body = s.body.slice(s.body.indexOf("\n") + 1);
      if ([...names].some((n) => new RegExp(`\\b${n}\\(`).test(body))) {
        names.add(s.name);
        grew = true;
      }
    }
  }
  return names;
}

describe("audit coverage", () => {
  const auditing = auditingNames();
  const actions = all.filter((s) => s.isAction);

  it("finds the server-action runners", () => {
    expect(actions.length).toBeGreaterThan(50);
  });

  it("every defineAction writes an audit row or is exempt", () => {
    const missing = actions
      .filter((a) => !EXEMPT[a.name])
      .filter((a) => ![...auditing].some((n) => new RegExp(`\\b${n}\\(`).test(a.body)))
      .map((a) => `${a.file}: ${a.name}`);
    expect(missing).toEqual([]);
  });

  it("every exemption names a real runner", () => {
    const names = new Set(actions.map((a) => a.name));
    expect(Object.keys(EXEMPT).filter((n) => !names.has(n))).toEqual([]);
  });
});

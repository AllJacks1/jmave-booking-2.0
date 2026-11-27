import { describe, expect, it } from "vitest";
import { diffJson, flatten, formatLeaf } from "./diff";

describe("flatten", () => {
  it("uses dot paths for objects and array indexes", () => {
    expect([...flatten({ a: { b: 1 }, c: [2, { d: 3 }] })]).toEqual([
      ["a.b", 1],
      ["c.0", 2],
      ["c.1.d", 3],
    ]);
  });
  it("keeps empty containers and scalars as leaves", () => {
    expect([...flatten({ a: {}, b: [] })]).toEqual([
      ["a", {}],
      ["b", []],
    ]);
    expect([...flatten("x")]).toEqual([["(value)", "x"]]);
  });
});

describe("diffJson", () => {
  it("reports added, removed and changed paths", () => {
    const rows = diffJson({ status: "pending", note: "a", gone: 1 }, { status: "confirmed", note: "a", extra: true });
    expect(rows).toEqual([
      { path: "status", kind: "changed", before: "pending", after: "confirmed" },
      { path: "gone", kind: "removed", before: 1 },
      { path: "extra", kind: "added", after: true },
    ]);
  });
  it("treats a null side as empty (create / delete)", () => {
    expect(diffJson(null, { id: "x" })).toEqual([{ path: "id", kind: "added", after: "x" }]);
    expect(diffJson({ id: "x" }, null)).toEqual([{ path: "id", kind: "removed", before: "x" }]);
    expect(diffJson(null, null)).toEqual([]);
  });
  it("diffs nested settings values", () => {
    const rows = diffJson({ business: { mobile: "+639170000001", name: "X" } }, { business: { mobile: "+639170000002", name: "X" } });
    expect(rows).toEqual([{ path: "business.mobile", kind: "changed", before: "+639170000001", after: "+639170000002" }]);
  });
  it("includes unchanged paths only when asked", () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffJson({ a: 1 }, { a: 1 }, { includeSame: true })).toEqual([{ path: "a", kind: "same", before: 1, after: 1 }]);
  });
  it("compares arrays by index", () => {
    expect(diffJson({ l: [1, 2] }, { l: [1, 3, 4] })).toEqual([
      { path: "l.1", kind: "changed", before: 2, after: 3 },
      { path: "l.2", kind: "added", after: 4 },
    ]);
  });
});

describe("formatLeaf", () => {
  it("formats scalars and objects", () => {
    expect(formatLeaf(null)).toBe("null");
    expect(formatLeaf(12)).toBe("12");
    expect(formatLeaf("x")).toBe("x");
    expect(formatLeaf({})).toBe("{}");
    expect(formatLeaf(undefined)).toBe("");
  });
});

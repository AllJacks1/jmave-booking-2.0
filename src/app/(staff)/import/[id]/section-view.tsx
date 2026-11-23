"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SECTION_LABELS, type PreviewItem, type SectionSummary } from "@/lib/import/types";

const ACTIONS = ["new", "changed", "unchanged", "skipped"] as const;
const PAGE = 100;

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function SectionView({ section }: { section: SectionSummary }) {
  const [filter, setFilter] = useState<(typeof ACTIONS)[number] | "warnings">(
    section.counts.new ? "new" : section.counts.changed ? "changed" : section.warnings.length ? "warnings" : "unchanged",
  );
  const [limit, setLimit] = useState(PAGE);
  const items = section.items.filter((i) => i.action === filter);
  const warnings = section.warnings.filter((w) => w.level !== "info");
  const infos = section.warnings.filter((w) => w.level === "info");
  const mismatches = section.warnings.filter((w) => w.level === "mismatch").length;

  return (
    <Card data-testid={`section-${section.section}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {SECTION_LABELS[section.section]}
          {section.section === "rate_cards" ? (
            mismatches ? (
              <Badge variant="destructive">{mismatches} mismatch(es) with pricing.md</Badge>
            ) : (
              <Badge variant="secondary">Matches pricing.md</Badge>
            )
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Button key={a} size="sm" variant={filter === a ? "secondary" : "outline"} onClick={() => (setFilter(a), setLimit(PAGE))}>
              {a[0].toUpperCase() + a.slice(1)} <span className="tabular-nums">{section.counts[a]}</span>
            </Button>
          ))}
          <Button size="sm" variant={filter === "warnings" ? "secondary" : "outline"} onClick={() => setFilter("warnings")}>
            Warnings <span className="tabular-nums">{warnings.length}</span>
          </Button>
        </div>
        {infos.length ? (
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {infos.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        ) : null}
        {filter === "warnings" ? (
          warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No warnings.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {warnings.slice(0, limit).map((w, i) => (
                <li key={i} className="flex gap-2">
                  <Badge variant={w.level === "mismatch" ? "destructive" : "outline"}>{w.level}</Badge>
                  <span className="text-muted-foreground">{w.tab ? `${w.tab}${w.row ? ` row ${w.row}` : ""}` : ""}</span>
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          )
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {items.slice(0, limit).map((item, i) => (
              <ItemRow key={i} item={item} />
            ))}
          </ul>
        )}
        {(filter === "warnings" ? warnings.length : items.length) > limit ? (
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ItemRow({ item }: { item: PreviewItem }) {
  const changes = Object.entries(item.changes ?? {});
  if (changes.length === 0) {
    return (
      <li className="px-3 py-2 text-sm">
        {item.label}
        {item.detail ? <span className="ml-2 text-muted-foreground">{item.detail}</span> : null}
      </li>
    );
  }
  return (
    <li className="text-sm">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
          <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
          {item.label}
          <span className="text-muted-foreground">
            {changes.length} field(s){item.detail ? ` · ${item.detail}` : ""}
          </span>
        </summary>
        <table className="mx-3 mb-2 text-xs">
          <tbody>
            {changes.map(([k, [before, after]]) => (
              <tr key={k}>
                <td className="py-0.5 pr-4 text-muted-foreground">{k}</td>
                {item.action === "changed" ? <td className="py-0.5 pr-4 line-through">{show(before)}</td> : null}
                <td className="py-0.5">{show(after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </li>
  );
}

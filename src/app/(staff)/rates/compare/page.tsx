import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { RateCardTables } from "@/components/rates/rate-card-tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { describePath, formatValue } from "@/lib/pricing/paths";
import { diffRateCards } from "@/lib/pricing/rate-card";
import { getRateCard, listRateCards } from "@/lib/rates/service";
import { RatesNav } from "../rates-nav";

export const metadata: Metadata = { title: "Compare rate cards" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { allowed } = await requirePage("rates.view");
  if (!allowed) return <NoAccess />;
  const sp = await searchParams;
  const cards = await listRateCards();
  const active = cards.find((c) => c.status === "active");
  const aId = sp.a && UUID.test(sp.a) ? sp.a : active?.id;
  const bId = sp.b && UUID.test(sp.b) ? sp.b : cards.find((c) => c.id !== aId)?.id;
  const [a, b] = await Promise.all([aId ? getRateCard(aId) : null, bId ? getRateCard(bId) : null]);
  const diffs = a && b ? diffRateCards(a.data, b.data) : [];

  return (
    <>
      <PageHeader title="Compare rate cards" description="Changed values are highlighted on both sides." />
      <RatesNav current="/rates/compare" />
      <form className="flex flex-wrap items-end gap-3" method="get">
        {(["a", "b"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            {k === "a" ? "From" : "To"}
            <select
              name={k}
              defaultValue={k === "a" ? aId : bId}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  v{c.version} — {c.name} ({c.status})
                </option>
              ))}
            </select>
          </label>
        ))}
        <Button type="submit" variant="outline">
          Compare
        </Button>
      </form>
      {!a || !b ? (
        <p className="text-sm text-muted-foreground">Two rate cards are needed to compare.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {diffs.length === 0 ? "No differences" : `${diffs.length} value(s) differ`} — v{a.version} → v{b.version}
              </CardTitle>
            </CardHeader>
            {diffs.length ? (
              <CardContent>
                <div className="max-h-96 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Value</TableHead>
                        <TableHead className="text-right">v{a.version}</TableHead>
                        <TableHead className="text-right">v{b.version}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diffs.map((d) => (
                        <TableRow key={d.path}>
                          <TableCell>{describePath(d.path)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatValue(d.path, d.before)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatValue(d.path, d.after)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            ) : null}
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <h2 className="font-semibold">
                v{a.version} — {a.name} ({a.status})
              </h2>
              <RateCardTables data={a.data} compareTo={b.data} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <h2 className="font-semibold">
                v{b.version} — {b.name} ({b.status})
              </h2>
              <RateCardTables data={b.data} compareTo={a.data} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

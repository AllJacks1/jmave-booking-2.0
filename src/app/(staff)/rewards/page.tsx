import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { rewardsListSchema } from "@/lib/loyalty/schema";
import { listAccounts, REWARDS_PAGE_SIZE } from "@/lib/loyalty/service";
import { pointsValueCentavos } from "@/lib/pricing/rewards";
import { fmtPeso } from "@/lib/quotes/document";
import { formatManilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "Rewards" };

const FILTERS = [
  { value: "all", label: "All cards" },
  { value: "unlinked", label: "No client" },
  { value: "expired", label: "Expired" },
] as const;

export default async function RewardsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { allowed } = await requirePage("rewards.view");
  if (!allowed) return <NoAccess />;
  const params = rewardsListSchema.parse(await searchParams);
  const { items, total } = await listAccounts(params);
  const pages = Math.max(1, Math.ceil(total / REWARDS_PAGE_SIZE));
  const qs = (over: { page?: number; filter?: string }) => {
    const p = { q: params.q, filter: over.filter ?? params.filter, page: String(over.page ?? params.page) };
    const kept = Object.entries(p).filter(([k, v]) => v && !(k === "filter" && v === "all") && !(k === "page" && v === "1"));
    return `/rewards?${new URLSearchParams(kept)}`;
  };

  return (
    <>
      <PageHeader title="Rewards" description="Loyalty cards: 50 points per rental day, 50 points = ₱1. A card is valid for one year; the next returned booking renews it." />
      <form className="flex flex-wrap items-center gap-2" method="get" role="search">
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={params.q} placeholder="Card number or client name" className="pl-8" aria-label="Search cards" />
        </div>
        {params.filter !== "all" ? <input type="hidden" name="filter" value={params.filter} /> : null}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => (
          <Button key={f.value} asChild size="sm" variant={params.filter === f.value ? "default" : "outline"}>
            <Link href={qs({ filter: f.value, page: 1 })}>{f.label}</Link>
          </Button>
        ))}
        <span className="text-muted-foreground">
          {total.toLocaleString("en-PH")} card{total === 1 ? "" : "s"}
        </span>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Card</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="hidden md:table-cell">Member since</TableHead>
              <TableHead className="hidden md:table-cell">Expires</TableHead>
              <TableHead className="hidden sm:table-cell">Tier</TableHead>
              <TableHead className="text-right">Points</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No loyalty cards found.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((a) => (
              <TableRow key={a.id} data-testid="reward-row">
                <TableCell>
                  <Link href={`/rewards/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                    {a.cardNo}
                  </Link>
                </TableCell>
                <TableCell>
                  {a.clientId ? (
                    <Link href={`/clients/${a.clientId}`} className="underline-offset-4 hover:underline">
                      {a.clientName}
                    </Link>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      {a.importedName ?? "—"}
                      <Badge variant="outline">No client</Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">{formatManilaDate(a.memberSince)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="flex items-center gap-2">
                    {formatManilaDate(a.expiresAt)}
                    {a.expired ? <Badge variant="destructive">Expired</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{a.tier ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{a.balance.toLocaleString("en-PH")}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtPeso(pointsValueCentavos(a.balance))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {params.page} of {pages}
          </span>
          {params.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs({ page: params.page - 1 })}>Previous</Link>
            </Button>
          ) : null}
          {params.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs({ page: params.page + 1 })}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

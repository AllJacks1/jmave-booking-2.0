import { FilePlus2Icon, ZapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { QuoteTable } from "@/components/quotes/quote-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_LABELS } from "@/lib/quotes/document";
import { requireQuotesPage } from "@/lib/quotes/page";
import { QUOTE_LIST_STATUSES, quoteListSchema } from "@/lib/quotes/schema";
import { listConsultants, listQuotations, QUOTES_PAGE_SIZE } from "@/lib/quotes/service";

export const metadata: Metadata = { title: "Quotations" };

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireQuotesPage();
  const raw = await searchParams;
  const params = quoteListSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined)));
  const [{ rows, total }, consultants] = await Promise.all([listQuotations(params), listConsultants()]);
  const pages = Math.max(1, Math.ceil(total / QUOTES_PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== "all" && k !== "page") p.set(k, String(v));
    }
    p.set("page", String(page));
    return `/quotes?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Quotations"
        description="All quotations and estimates. The team works shared leads."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/quotes/quick">
                <ZapIcon />
                Quick quote
              </Link>
            </Button>
            <Button asChild>
              <Link href="/quotes/new">
                <FilePlus2Icon />
                New quotation
              </Link>
            </Button>
          </>
        }
      />
      <form className="flex flex-wrap items-end gap-3" method="get" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="QTN-2026-929 or client name" />
        </div>
        <Filter id="status" label="Status" value={params.status} options={QUOTE_LIST_STATUSES.map((s) => [s, s === "all" ? "All" : STATUS_LABELS[s]])} />
        <Filter
          id="service"
          label="Service"
          value={params.service}
          options={[
            ["all", "All"],
            ["self_drive", "Self-Drive"],
            ["with_driver", "With Driver"],
          ]}
        />
        <Filter
          id="kind"
          label="Type"
          value={params.kind}
          options={[
            ["all", "All"],
            ["formal", "Formal"],
            ["quick", "Estimate"],
          ]}
        />
        <Filter
          id="consultant"
          label="Consultant"
          value={params.consultant}
          options={[["all", "All"], ...consultants.map((c): [string, string] => [c.id, c.displayName])]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={params.from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={params.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("en-PH")} quotation{total === 1 ? "" : "s"}
      </p>
      <Card className="py-0">
        <QuoteTable rows={rows} empty="No quotations match." />
      </Card>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {params.page} of {pages}
          </span>
          {params.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          {params.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Filter({ id, label, value, options }: { id: string; label: string; value: string; options: [string, string][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={id} defaultValue={value} className={selectClass}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { RateCardTables } from "@/components/rates/rate-card-tables";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { getActiveRateCard, listRateCards } from "@/lib/rates/service";
import { formatManilaDateTime } from "@/lib/time";
import { CardActions } from "./card-actions";
import { RatesNav } from "./rates-nav";
import { RateCardStatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Rates" };

export default async function RatesPage() {
  const { user, allowed } = await requirePage("rates.view");
  if (!allowed) return <NoAccess />;
  const [cards, active] = await Promise.all([listRateCards(), getActiveRateCard()]);
  const canEdit = can(user, "rates.edit");

  return (
    <>
      <PageHeader
        title="Rates"
        description={canEdit ? "Rate cards used by the pricing engine. Edit a draft, then activate it." : "Read-only. Only a Super Admin can change rates."}
      />
      <RatesNav current="/rates" />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Effective from</TableHead>
              <TableHead className="hidden md:table-cell">Source</TableHead>
              {canEdit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No rate cards yet. Import the booking workbook to create v1.
                </TableCell>
              </TableRow>
            ) : null}
            {cards.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link className="underline-offset-4 hover:underline" href={`/rates/${c.id}`}>
                    v{c.version}
                  </Link>
                </TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell>
                  <RateCardStatusBadge status={c.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{c.effectiveFrom ? formatManilaDateTime(c.effectiveFrom) : "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{c.source ?? "—"}</TableCell>
                {canEdit ? (
                  <TableCell>
                    <CardActions card={c} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {active ? (
        <>
          <h2 className="text-lg font-semibold">
            Active: v{active.version} — {active.name}
          </h2>
          <RateCardTables data={active.data} />
        </>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No active rate card. Quotations cannot be priced until one is active.</CardContent>
        </Card>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { RateCardTables } from "@/components/rates/rate-card-tables";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { getActiveRateCard, getRateCard } from "@/lib/rates/service";
import { CardActions } from "../card-actions";
import { RatesNav } from "../rates-nav";
import { RateCardStatusBadge } from "../status-badge";

export const metadata: Metadata = { title: "Rate card" };

export default async function RateCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("rates.view");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [card, active] = await Promise.all([getRateCard(id), getActiveRateCard()]);
  if (!card) notFound();

  return (
    <>
      <PageHeader
        title={`v${card.version} — ${card.name}`}
        description={
          <span className="flex items-center gap-2">
            <RateCardStatusBadge status={card.status} />
            {card.source ? <span>Source: {card.source}</span> : null}
          </span>
        }
        actions={can(user, "rates.edit") ? <CardActions card={card} size="default" /> : null}
      />
      <RatesNav current="" />
      {card.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{card.notes}</p> : null}
      {!card.valid ? (
        <Alert variant="destructive">
          <AlertDescription>This card has invalid values and cannot be activated.</AlertDescription>
        </Alert>
      ) : null}
      {active && active.id !== card.id ? (
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/rates/compare?a=${active.id}&b=${card.id}`}>Compare with active v{active.version}</Link>
          </Button>
        </div>
      ) : null}
      <RateCardTables data={card.data} />
    </>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Card, CardContent } from "@/components/ui/card";
import { requirePage } from "@/lib/auth/page";
import { getRateCard, holidayDates, listRateCards } from "@/lib/rates/service";
import { getSettings } from "@/lib/settings/service";
import { RatesNav } from "../rates-nav";
import { Playground } from "./playground";

export const metadata: Metadata = { title: "Pricing playground" };

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ card?: string }> }) {
  // PLAN: Admin and up (same as viewing rate cards).
  const { allowed } = await requirePage("rates.view");
  if (!allowed) return <NoAccess />;
  const sp = await searchParams;
  const [cards, holidays, settings] = await Promise.all([listRateCards(), holidayDates(), getSettings()]);
  const chosenId =
    sp.card && cards.some((c) => c.id === sp.card) ? sp.card : (cards.find((c) => c.status === "active")?.id ?? cards[0]?.id);
  const card = chosenId ? await getRateCard(chosenId) : null;

  return (
    <>
      <PageHeader title="Pricing playground" description="Try any input and check the numbers against the old sheet. Nothing is saved." />
      <RatesNav current="/rates/playground" />
      {!card ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No rate card yet. Import the booking workbook first.</CardContent>
        </Card>
      ) : (
        <Playground
          card={{ id: card.id, version: card.version, name: card.name, status: card.status, data: card.data }}
          cards={cards.map((c) => ({ id: c.id, label: `v${c.version} — ${c.name} (${c.status})` }))}
          holidays={holidays}
          fuelPrices={settings.fuel_prices_centavos}
        />
      )}
    </>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/permissions";
import { BODY_CATEGORIES } from "@/lib/pricing/types";
import { newQuoteForm } from "@/lib/quotes/defaults";
import { requireQuotesPage } from "@/lib/quotes/page";
import { listVehiclesForQuotes } from "@/lib/quotes/service";
import { getActiveRateCard } from "@/lib/rates/service";
import { getSettings } from "@/lib/settings/service";
import { addDaysToKey, isDateKey } from "@/lib/time";
import { NoRateCard } from "../no-rate-card";
import { QuoteEditor } from "../quote-editor";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireQuotesPage();
  const [settings, vehicles, card] = await Promise.all([getSettings(), listVehiclesForQuotes(), getActiveRateCard()]);
  // From the calendar: `?vehicle=<id>&date=YYYY-MM-DD` pre-fills the car and the release date.
  const sp = await searchParams;
  const initial = newQuoteForm("formal", settings.fuel_prices_centavos);
  const vehicle = vehicles.find((v) => v.id === sp.vehicle);
  if (vehicle) {
    initial.vehicleId = vehicle.id;
    if (vehicle.bodyType) {
      initial.bodyType = vehicle.bodyType;
      const cats = BODY_CATEGORIES[vehicle.bodyType];
      if (!initial.category || !cats.includes(initial.category)) initial.category = cats.includes("primo") ? "primo" : (cats[0] ?? null);
    }
  }
  if (sp.date && isDateKey(sp.date)) {
    initial.startDate = sp.date;
    initial.endDate = addDaysToKey(sp.date, 1);
  }
  return (
    <>
      <PageHeader title="New quotation" description="Formal, numbered quotation. Drafts save automatically." />
      {!card ? (
        <NoRateCard />
      ) : (
        <QuoteEditor
          mode="formal"
          id={null}
          initial={initial}
          vehicles={vehicles}
          initialClient={null}
          canOverrideBlacklist={can(user, "quotes.override_blacklist")}
          businessName={settings.business.name}
          canRedeem={can(user, "rewards.redeem")}
        />
      )}
    </>
  );
}

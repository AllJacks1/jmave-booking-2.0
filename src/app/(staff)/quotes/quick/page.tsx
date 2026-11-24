import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/permissions";
import { newQuoteForm } from "@/lib/quotes/defaults";
import { requireQuotesPage } from "@/lib/quotes/page";
import { listVehiclesForQuotes } from "@/lib/quotes/service";
import { getSettings } from "@/lib/settings/service";
import { NoRateCard } from "../no-rate-card";
import { QuoteEditor } from "../quote-editor";
import { getActiveRateCard } from "@/lib/rates/service";

export const metadata: Metadata = { title: "Quick quotation" };

export default async function QuickQuotePage() {
  const user = await requireQuotesPage();
  const [settings, vehicles, card] = await Promise.all([getSettings(), listVehiclesForQuotes(), getActiveRateCard()]);
  return (
    <>
      <PageHeader title="Quick quotation" description="An estimate in under a minute: PDF or text for Messenger. No number until you make it formal." />
      {!card ? (
        <NoRateCard />
      ) : (
        <QuoteEditor
          mode="quick"
          id={null}
          initial={newQuoteForm("quick", settings.fuel_prices_centavos)}
          vehicles={vehicles}
          initialClient={null}
          canOverrideBlacklist={can(user, "quotes.override_blacklist")}
          businessName={settings.business.name}
        />
      )}
    </>
  );
}

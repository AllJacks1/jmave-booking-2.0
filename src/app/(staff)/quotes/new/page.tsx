import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/permissions";
import { newQuoteForm } from "@/lib/quotes/defaults";
import { requireQuotesPage } from "@/lib/quotes/page";
import { listVehiclesForQuotes } from "@/lib/quotes/service";
import { getActiveRateCard } from "@/lib/rates/service";
import { getSettings } from "@/lib/settings/service";
import { NoRateCard } from "../no-rate-card";
import { QuoteEditor } from "../quote-editor";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotePage() {
  const user = await requireQuotesPage();
  const [settings, vehicles, card] = await Promise.all([getSettings(), listVehiclesForQuotes(), getActiveRateCard()]);
  return (
    <>
      <PageHeader title="New quotation" description="Formal, numbered quotation. Drafts save automatically." />
      {!card ? (
        <NoRateCard />
      ) : (
        <QuoteEditor
          mode="formal"
          id={null}
          initial={newQuoteForm("formal", settings.fuel_prices_centavos)}
          vehicles={vehicles}
          initialClient={null}
          canOverrideBlacklist={can(user, "quotes.override_blacklist")}
          businessName={settings.business.name}
        />
      )}
    </>
  );
}

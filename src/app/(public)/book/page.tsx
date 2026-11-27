import type { Metadata } from "next";
import { formatPhPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings/service";
import { manilaDateKey } from "@/lib/time";
import { BookingWizard, ContactList, type BusinessContact } from "./booking-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Book a car · J-MaVe Cars" },
  description: "Check available cars and prices for your dates and send a booking request. Self-Drive and With Driver car rental in Davao City.",
  robots: { index: true, follow: true },
};

/**
 * Public booking page (Phase 4). No login. `?embed=1` hides the header and
 * footer for an iframe on the company website (see Settings → Embed).
 */
export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  const b = (await getSettings()).business;
  const business: BusinessContact = {
    name: b.name,
    mobile: formatPhPhone(b.mobile),
    landline: formatPhPhone(b.landline),
    email: b.email,
    address: b.address,
  };
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;
  const wizard = <BookingWizard siteKey={siteKey} business={business} embed={embed} today={manilaDateKey(new Date())} />;

  if (embed) return <main className="p-3 sm:p-4">{wizard}</main>;
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-4">
          <span className="text-lg font-bold text-primary">{business.name}</span>
          <a href={`tel:${b.mobile}`} className="ml-auto text-sm font-medium text-primary">
            {business.mobile}
          </a>
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{wizard}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 sm:flex-row sm:justify-between">
          <ContactList business={business} />
          <a href="/book/privacy" className="text-sm text-muted-foreground underline">
            Privacy notice
          </a>
        </div>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import { formatPhPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Privacy notice · J-MaVe Cars" },
  robots: { index: true, follow: true },
};

/** Privacy notice for the public booking page (Data Privacy Act of 2012, RA 10173). */
export default async function PrivacyPage() {
  const b = (await getSettings()).business;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Privacy notice</h1>
      <p>
        {b.name} (&quot;we&quot;) respects your privacy and processes personal data in line with the Data Privacy Act of 2012 (Republic Act No. 10173), its
        Implementing Rules and Regulations, and issuances of the National Privacy Commission.
      </p>
      <h2 className="text-lg font-semibold">What we collect</h2>
      <p>
        When you send a booking request: your name, mobile number, email, birthday, home address, company, alternative contact person and their number,
        driver&apos;s license number and type, the IDs you can present, delivery and pick-up addresses, trip details (dates, destination, passengers, luggage,
        itinerary), your payment preference and special requests. We also record technical data: your IP address, browser (user agent), the page that
        referred you and campaign tags in the link you used (for example UTM parameters).
      </p>
      <h2 className="text-lg font-semibold">Why we use it</h2>
      <ul className="list-disc pl-5">
        <li>To check availability, prepare your quotation, and contact you about your request.</li>
        <li>To process the booking, rental agreement, payments and vehicle release and return, if you go ahead.</li>
        <li>To keep records required by law and to protect our vehicles and clients (for example, fraud prevention).</li>
        <li>To understand which of our pages and advertisements bring requests.</li>
      </ul>
      <p>Our basis is your consent and the steps you ask us to take before entering into a rental contract.</p>
      <h2 className="text-lg font-semibold">Who receives it</h2>
      <p>
        Our staff who handle bookings; our customer-relationship system (Rework), which stores your request as a lead; and Cloudflare, which runs the
        security check on the form. They process data only for these purposes. We do not sell your data.
      </p>
      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>
        Requests that do not become bookings are kept for up to two years. Booking records are kept for as long as tax and business laws require. Then
        they are deleted or anonymised.
      </p>
      <h2 className="text-lg font-semibold">Your rights</h2>
      <p>
        You may ask to be informed, to access, correct or erase your data, to object to processing, to data portability, and to withdraw consent. You may
        also file a complaint with the National Privacy Commission (privacy.gov.ph).
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>
        {b.name}, {b.address}. Email <a className="text-primary underline" href={`mailto:${b.email}`}>{b.email}</a>, mobile {formatPhPhone(b.mobile)}.
      </p>
      <p>
        <a href="/book" className="text-primary underline">
          Back to booking
        </a>
      </p>
    </main>
  );
}

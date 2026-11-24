import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { QuoteDocView } from "@/components/quotes/quote-doc-view";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bookingForQuotation } from "@/lib/bookings/queries";
import { can } from "@/lib/permissions";
import { fmtDateTime, quoteText } from "@/lib/quotes/document";
import { requireQuotesPage } from "@/lib/quotes/page";
import { getQuotation, listVehiclesForQuotes, toDoc } from "@/lib/quotes/service";
import { getSettings } from "@/lib/settings/service";
import { QuoteEditor } from "../quote-editor";
import { ImportedQuote } from "./imported-quote";
import { QuoteActions } from "./quote-actions";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireQuotesPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const q = await getQuotation(id);
  if (!q) notFound();
  const settings = await getSettings();
  const canOverride = can(user, "quotes.override_blacklist");

  // Editable: formal drafts and saved quick estimates.
  if (q.imported) {
    return <ImportedQuote q={q} booking={await bookingForQuotation(q.id)} canConvert={can(user, "bookings.manage")} />;
  }

  if ((q.kind === "quick" || q.status === "draft") && q.form) {
    const vehicles = await listVehiclesForQuotes();
    return (
      <>
        <PageHeader
          title={q.kind === "quick" ? "Quick quotation" : "Draft quotation"}
          description={q.kind === "quick" ? "Saved estimate. Saving again updates it." : "Drafts save automatically. Issue to give it a number."}
        />
        <QuoteEditor
          mode={q.kind}
          id={q.id}
          initial={q.form}
          vehicles={vehicles}
          initialClient={
            q.client
              ? {
                  id: q.client.id,
                  fullName: q.client.fullName,
                  isBlacklisted: q.client.isBlacklisted,
                  blacklistReason: q.client.blacklistReason,
                  isRepeat: q.client.firstRentalAt !== null,
                  clientType: q.client.clientType,
                }
              : null
          }
          canOverrideBlacklist={canOverride}
          businessName={settings.business.name}
          validUntil={q.validUntil?.toISOString() ?? null}
          revisedFromNumber={q.revisedFromNumber}
        />
      </>
    );
  }

  const doc = toDoc(q, settings.business);
  if (!doc) notFound();
  const booking = await bookingForQuotation(q.id);

  return (
    <>
      <PageHeader
        title={q.number ?? "Quotation"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <QuoteStatusBadge status={q.effective} kind={q.kind} />
            {q.clientName ?? "No client"} · {q.consultantName ?? "—"}
          </span>
        }
      />
      <QuoteActions
        id={q.id}
        status={q.effective}
        shareToken={q.shareToken}
        text={quoteText(doc)}
        booking={booking}
        canConvert={q.kind === "formal" && can(user, "bookings.manage")}
        hasVehicle={Boolean(q.vehicleId)}
      />
      {q.effective === "cancelled" && q.statusNote ? (
        <Alert>
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>
            {q.statusNote}.{" "}
            {q.revisedById ? (
              <Link className="underline" href={`/quotes/${q.revisedById}`}>
                Open the revision
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {q.effective === "lost" && q.statusNote ? (
        <Alert>
          <AlertTitle>Lost</AlertTitle>
          <AlertDescription>{q.statusNote}</AlertDescription>
        </Alert>
      ) : null}
      {q.effective === "expired" ? (
        <Alert>
          <AlertTitle>Expired</AlertTitle>
          <AlertDescription>Valid until {q.validUntil ? fmtDateTime(q.validUntil) : "—"}. Revise it to send an updated quotation.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <QuoteDocView doc={doc} />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Internal</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Info label="Rate card" value={q.rateCardVersion ? `v${q.rateCardVersion} (snapshot)` : "—"} />
            <Info label="Issued" value={q.issuedAt ? fmtDateTime(q.issuedAt) : "—"} />
            {q.revisedFromNumber ? <Info label="Revision of" value={q.revisedFromNumber} /> : null}
            {q.client ? (
              <Info
                label="Client record"
                value={
                  <Link className="underline" href={`/clients/${q.client.id}`}>
                    {q.client.fullName}
                  </Link>
                }
              />
            ) : null}
            {q.blacklistOverrideReason ? (
              <Info label="Blacklist override" value={`${q.blacklistOverrideReason} (${q.overrideByName ?? "—"})`} />
            ) : null}
            <Info label="Notes" value={q.notes || "—"} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <div className="break-words whitespace-pre-wrap">{value}</div>
    </div>
  );
}

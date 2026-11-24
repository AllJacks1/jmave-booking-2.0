import { FileDownIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteDocView } from "@/components/quotes/quote-doc-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime, fmtPhone, type Business } from "@/lib/quotes/document";
import { getByShareToken, shareLinkOpen } from "@/lib/quotes/service";
import { EXPIRED_MESSAGE } from "@/lib/quotes/terms";
import { getSettings } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quotation",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Public, read-only client copy (PLAN §6.5). No staff data. */
export default async function SharedQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getByShareToken(token);
  if (!found) notFound();
  const { row, doc } = found;

  if (!shareLinkOpen(row)) {
    return (
      <Shell>
        <Expired business={(await getSettings()).business} />
      </Shell>
    );
  }

  return (
    <Shell>
      {doc.status === "expired" ? (
        <Alert className="mx-auto w-full max-w-3xl">
          <AlertTitle>{EXPIRED_MESSAGE}</AlertTitle>
          <AlertDescription>
            It was valid until {doc.validUntil ? fmtDateTime(doc.validUntil) : "—"}. Call {fmtPhone(doc.business.mobile)} or email {doc.business.email}.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mx-auto flex w-full max-w-3xl justify-end">
        <Button asChild>
          <a href={`/q/${token}/pdf`} download>
            <FileDownIcon />
            Download PDF
          </a>
        </Button>
      </div>
      <QuoteDocView doc={doc} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-svh flex-col gap-4 bg-muted/30 p-4 sm:p-8">{children}</main>;
}

function Expired({ business }: { business: Business }) {
  return (
    <Card className="mx-auto mt-10 w-full max-w-md" data-testid="share-expired">
      <CardContent className="flex flex-col gap-3 py-8 text-center">
        <p className="text-xl font-bold text-primary">{business.name}</p>
        <p className="font-medium">{EXPIRED_MESSAGE}</p>
        <div className="text-sm text-muted-foreground">
          <p>Mobile: {fmtPhone(business.mobile)}</p>
          <p>Landline: {fmtPhone(business.landline)}</p>
          <p>Email: {business.email}</p>
          <p>{business.address}</p>
        </div>
      </CardContent>
    </Card>
  );
}

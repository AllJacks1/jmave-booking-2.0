import { FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireInquiriesPage } from "@/lib/inquiries/page";
import { getInquiry } from "@/lib/inquiries/service";
import { DRIVING_TERM_LABELS, WD_PACKAGE_LABELS } from "@/lib/pricing/inputs";
import { SERVICE_AREA_LABELS, SERVICE_LABELS } from "@/lib/pricing/types";
import { formatPhPhone, normalisePhPhone } from "@/lib/phone";
import { fmtPeso } from "@/lib/quotes/document";
import { DRIVERS_LICENSE_LABELS, type DriversLicenseType } from "@/lib/rework/options";
import { formatManilaDateTime } from "@/lib/time";
import { InquiryStatusBadge } from "../status";
import { RejectInquiry } from "./reject";

export const metadata: Metadata = { title: "Booking request" };

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words whitespace-pre-line">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const phone = (p: string | null | undefined) => (p ? formatPhPhone(normalisePhPhone(p) ?? p) : null);

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInquiriesPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const inq = await getInquiry(id);
  if (!inq) notFound();
  const s = inq.search;
  const d = inq.details;
  const wd = inq.service === "with_driver";
  const open = inq.status === "new" || inq.status === "quoted";

  return (
    <>
      <PageHeader
        title={inq.reference}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <InquiryStatusBadge status={inq.status} /> Received {formatManilaDateTime(inq.createdAt)} · {SERVICE_LABELS[inq.service]}
            {inq.reviewerName ? ` · handled by ${inq.reviewerName}` : ""}
          </span>
        }
        actions={
          <>
            {inq.quotation ? (
              <Button asChild>
                <Link href={`/quotes/${inq.quotation.id}`}>
                  <FileTextIcon />
                  {inq.quotation.status === "draft" ? "Review quotation" : `Open ${inq.quotation.number ?? "quotation"}`}
                </Link>
              </Button>
            ) : null}
            {open ? <RejectInquiry id={inq.id} /> : null}
          </>
        }
      />

      {inq.client?.isBlacklisted ? (
        <Alert variant="destructive">
          <AlertTitle>Blacklisted client</AlertTitle>
          <AlertDescription>{inq.client.blacklistReason ?? "No reason recorded."} Only an Admin can issue a quotation for them.</AlertDescription>
        </Alert>
      ) : null}
      {inq.notes ? (
        <Alert>
          <AlertTitle>Check before quoting</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{inq.notes}</AlertDescription>
        </Alert>
      ) : null}
      {inq.status === "rejected" ? (
        <Alert>
          <AlertTitle>Rejected</AlertTitle>
          <AlertDescription>{inq.rejectReason}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trip</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows
              rows={[
                ["Service", SERVICE_LABELS[inq.service]],
                ["Car", inq.vehicle ? `${inq.vehicle.displayName}${inq.vehicle.plate ? ` · ${inq.vehicle.plate}` : ""}` : "—"],
                [wd ? "Start" : "Pick-up", formatManilaDateTime(inq.startAt)],
                [wd ? "End (last day)" : "Return", formatManilaDateTime(inq.endAt)],
                ["Destination", s?.destination],
                ...(wd && s
                  ? ([
                      ["Days", s.wdDays],
                      ["Trip type", WD_PACKAGE_LABELS[s.package]],
                      ["Driver waits", DRIVING_TERM_LABELS[s.drivingTerm]],
                      ["Area", SERVICE_AREA_LABELS[s.serviceArea]],
                      ["One-way km (estimate)", s.oneWayKm || "not given"],
                      ["Pick-up place", d?.pickupAddress],
                      ["Drop-off place", d?.dropoffAddress],
                      ["Passengers", d?.passengers || null],
                      ["Luggage", d?.luggage],
                      ["Itinerary", d?.itinerary],
                    ] as [string, React.ReactNode][])
                  : ([
                      ["Deliver to", d?.deliveryAddress],
                      ["Collect at return from", d?.pickupAddress],
                    ] as [string, React.ReactNode][])),
                ["Payment preference", s?.paymentMethod],
                ["Special requests", d?.specialRequests],
                ["Price shown", inq.shownTotalCentavos !== null ? `${fmtPeso(inq.shownTotalCentavos)} (without the new-client discount)` : null],
                ["Draft quotation total", inq.quotation?.totalCentavos != null ? fmtPeso(inq.quotation.totalCentavos) : null],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Client</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {inq.client ? (
              <p className="text-sm">
                <Link href={`/clients/${inq.client.id}`} className="font-medium text-primary hover:underline">
                  {inq.client.fullName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {inq.client.source === "website" ? "· new client from the website" : "· existing client (matched by phone)"}
                  {inq.client.firstRentalAt ? " · repeat" : ""}
                </span>
              </p>
            ) : null}
            <Rows
              rows={[
                ["Name on request", d?.fullName],
                ["Mobile", phone(d?.phone)],
                ["Email", d?.email],
                ["Birthday", d?.birthday],
                ["Address", d?.address],
                ["Company", d?.companyName],
                ["Alternative contact", d?.altContactName ? `${d.altContactName}${d.altContactPhone ? ` – ${phone(d.altContactPhone) ?? d.altContactPhone}` : ""}` : null],
                ["Driver's license no.", d?.driversLicenseNo],
                ["License type", d?.driversLicenseType ? DRIVERS_LICENSE_LABELS[d.driversLicenseType as DriversLicenseType] : null],
                ["IDs to present", d?.idsPresented.join(", ")],
                ["Privacy consent", inq.consentAt ? formatManilaDateTime(new Date(inq.consentAt)) : null],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows
              rows={[
                ...Object.entries(inq.attribution).map(([k, v]) => [k, v] as [string, React.ReactNode]),
                ["IP address", inq.requestMeta.ip ?? null],
                ["Browser", inq.requestMeta.userAgent ?? null],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rework</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {inq.deliveries.length === 0 ? (
              <p className="text-muted-foreground">No lead queued.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {inq.deliveries.map((o) => (
                  <li key={o.id} data-testid="rework-delivery">
                    Lead {o.status}
                    {o.sentAt ? ` ${formatManilaDateTime(o.sentAt)}` : ""} · {o.attempts} attempt{o.attempts === 1 ? "" : "s"}
                    {o.lastError ? <span className="block text-destructive">{o.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

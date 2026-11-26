import { PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/bookings/status";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clientHistory, rentalDays } from "@/lib/bookings/queries";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { effectiveStatus, fmtPeso } from "@/lib/quotes/document";
import { requirePage } from "@/lib/auth/page";
import { CLIENT_TYPE_LABELS } from "@/lib/clients/schema";
import { getClient, isRepeatClient } from "@/lib/clients/service";
import { can } from "@/lib/permissions";
import { formatPhPhone } from "@/lib/phone";
import { formatManilaDate, formatManilaDateTime } from "@/lib/time";
import { BlacklistBadge, RepeatBadge } from "../client-badges";
import { LoyaltySummary } from "@/components/rewards/loyalty-summary";
import { accountForClient } from "@/lib/loyalty/service";
import { BlacklistControl } from "./blacklist-control";

export const metadata: Metadata = { title: "Client" };

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added in the app",
  import: "Imported from the rental logs",
  blacklist_import: "Imported from the DMS blacklist",
};

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("clients.view");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getClient(id);
  if (!c) notFound();
  const canRewards = can(user, "rewards.view");
  const [history, loyalty] = await Promise.all([clientHistory(c.id), canRewards ? accountForClient(c.id) : Promise.resolve(null)]);
  const canBookings = can(user, "bookings.manage");
  const canQuotes = can(user, "quotes.manage");

  return (
    <>
      <PageHeader
        title={c.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.isBlacklisted ? <BlacklistBadge /> : null}
            <RepeatBadge repeat={isRepeatClient(c)} />
            <span>{CLIENT_TYPE_LABELS[c.clientType]}</span>
          </span>
        }
        actions={
          <>
            {can(user, "clients.blacklist") ? (
              <BlacklistControl id={c.id} name={c.fullName} blacklisted={c.isBlacklisted} reason={c.blacklistReason} />
            ) : null}
            {can(user, "clients.edit") ? (
              <Button asChild variant="outline">
                <Link href={`/clients/${c.id}/edit`}>
                  <PencilIcon />
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {c.isBlacklisted ? (
        <Alert variant="destructive">
          <AlertTitle>Blacklisted</AlertTitle>
          <AlertDescription>{c.blacklistReason ?? "No reason recorded."}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="FB name">{c.fbName}</Row>
              <Row label="Phone">{c.phone ? formatPhPhone(c.phone) : null}</Row>
              <Row label="Email">{c.email}</Row>
              <Row label="Birthday">{c.birthday ? formatManilaDate(c.birthday) : null}</Row>
              <Row label="Address">{c.address}</Row>
              <Row label="Alternative contact">
                {[c.altContactName, c.altContactPhone ? formatPhPhone(c.altContactPhone) : null].filter(Boolean).join(" · ") || null}
              </Row>
              <Row label="Company">{c.companyName}</Row>
              <Row label="Driver's license no.">{c.driversLicenseNo}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Record</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="First rental">{c.firstRentalAt ? formatManilaDate(c.firstRentalAt) : "None yet (new client)"}</Row>
              <Row label="Source">{SOURCE_LABELS[c.source] ?? c.source}</Row>
              <Row label="Created">{formatManilaDateTime(c.createdAt)}</Row>
              <Row label="Updated">{formatManilaDateTime(c.updatedAt)}</Row>
              <Row label="Notes">{c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : null}</Row>
            </dl>
          </CardContent>
        </Card>
        {canRewards ? (
          <Card data-testid="client-rewards">
            <CardHeader>
              <CardTitle>Rewards</CardTitle>
              {loyalty ? (
                <CardDescription>
                  <Link href={`/rewards/${loyalty.account.id}`} className="underline-offset-4 hover:underline">
                    Open card and history
                  </Link>
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              {loyalty ? (
                <LoyaltySummary
                  cardNo={loyalty.account.cardNo}
                  memberSince={loyalty.account.memberSince}
                  expiresAt={loyalty.account.expiresAt}
                  expired={loyalty.expired}
                  tier={loyalty.account.tier}
                  balance={loyalty.balance}
                  href={`/rewards/${loyalty.account.id}`}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No loyalty card yet. It is created when this client’s first booking is returned.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rental history</CardTitle>
          <CardDescription>
            {history.rentals} rental{history.rentals === 1 ? "" : "s"} · {history.lifetimeDays} day{history.lifetimeDays === 1 ? "" : "s"} rented in total
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 px-0">
          <div>
            <h3 className="px-6 pb-2 text-sm font-medium">Bookings</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Release</TableHead>
                  <TableHead>Return</TableHead>
                  <TableHead className="pr-6 text-right">Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.bookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="pl-6 text-muted-foreground">
                      No bookings.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.bookings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="pl-6 font-medium">
                        {canBookings ? (
                          <Link className="underline-offset-4 hover:underline" href={`/bookings/${b.id}`}>
                            {b.number}
                          </Link>
                        ) : (
                          b.number
                        )}
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{b.vehicleName ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatManilaDateTime(b.startAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatManilaDateTime(b.endAt)}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{rentalDays(b.startAt, b.endAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div>
            <h3 className="px-6 pb-2 text-sm font-medium">Quotations</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Travel date</TableHead>
                  <TableHead className="pr-6 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.quotations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="pl-6 text-muted-foreground">
                      No quotations.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.quotations.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="pl-6 font-medium">
                        {canQuotes ? (
                          <Link className="underline-offset-4 hover:underline" href={`/quotes/${q.id}`}>
                            {q.number}
                          </Link>
                        ) : (
                          q.number
                        )}
                        {q.imported ? <span className="ml-2 text-xs text-muted-foreground">imported</span> : null}
                      </TableCell>
                      <TableCell>
                        <QuoteStatusBadge status={effectiveStatus(q)} />
                      </TableCell>
                      <TableCell>{SERVICE_LABELS[q.service]}</TableCell>
                      <TableCell>{q.startAt ? formatManilaDate(q.startAt) : "—"}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{q.totalCentavos !== null ? fmtPeso(q.totalCentavos) : "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children ?? "—"}</dd>
    </>
  );
}

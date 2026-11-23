import { PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePage } from "@/lib/auth/page";
import { CLIENT_TYPE_LABELS } from "@/lib/clients/schema";
import { getClient, isRepeatClient } from "@/lib/clients/service";
import { can } from "@/lib/permissions";
import { formatPhPhone } from "@/lib/phone";
import { formatManilaDate, formatManilaDateTime } from "@/lib/time";
import { BlacklistBadge, RepeatBadge } from "../client-badges";
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
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rental history</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Quotations and bookings appear here from Phase 1c and 2a.</CardContent>
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

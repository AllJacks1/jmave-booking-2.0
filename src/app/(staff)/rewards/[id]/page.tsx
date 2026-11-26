import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { LoyaltySummary } from "@/components/rewards/loyalty-summary";
import { PointsHistory } from "@/components/rewards/points-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePage } from "@/lib/auth/page";
import { getAccount } from "@/lib/loyalty/service";
import { can } from "@/lib/permissions";
import { formatPhPhone } from "@/lib/phone";
import { AccountControls } from "./account-controls";

export const metadata: Metadata = { title: "Loyalty card" };

export default async function RewardPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("rewards.view");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getAccount(id);
  if (!d) notFound();
  const a = d.account;

  return (
    <>
      <PageHeader
        title={a.cardNo}
        description={d.client ? d.client.fullName : (a.importedName ?? "No client linked")}
        actions={
          <AccountControls
            accountId={a.id}
            balance={d.balance}
            tier={a.tier}
            linked={Boolean(a.clientId)}
            canAdjust={can(user, "rewards.adjust")}
            canEditTier={can(user, "rewards.edit_tier")}
          />
        }
      />
      {!a.clientId ? (
        <Alert>
          <AlertTitle>Not linked to a client</AlertTitle>
          <AlertDescription>
            The import could not match this card to a client{a.importedName ? ` (workbook name: ${a.importedName})` : ""}. Link it so the client can earn and redeem on it.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Card</CardTitle>
          </CardHeader>
          <CardContent>
            <LoyaltySummary cardNo={a.cardNo} memberSince={a.memberSince} expiresAt={a.expiresAt} expired={d.expired} tier={a.tier} balance={d.balance} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Member</CardTitle>
            <CardDescription>
              {d.totals.rentals} rental{d.totals.rentals === 1 ? "" : "s"} · {d.totals.earned.toLocaleString("en-PH")} points earned ·{" "}
              {d.totals.redeemed.toLocaleString("en-PH")} redeemed
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.client ? (
              <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>
                  <Link href={`/clients/${d.client.id}`} className="underline-offset-4 hover:underline">
                    {d.client.fullName}
                  </Link>
                </dd>
                <dt className="text-muted-foreground">Contact</dt>
                <dd>{[d.client.phone ? formatPhPhone(d.client.phone) : null, d.client.email].filter(Boolean).join(" · ") || "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{d.client.address ?? "—"}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No client linked.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <PointsHistory entries={d.history} linkBookings={can(user, "bookings.manage")} />
        </CardContent>
      </Card>
    </>
  );
}

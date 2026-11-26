import { FilePlus2Icon, ZapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { QuoteTable } from "@/components/quotes/quote-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireQuotesPage } from "@/lib/quotes/page";
import { dashboardData } from "@/lib/quotes/service";
import { DUTY_LABELS } from "@/lib/bookings/constants";
import { onDutyNow } from "@/lib/roster/service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireQuotesPage();
  const [{ mine, expiring, recent }, onDuty] = await Promise.all([dashboardData(user), onDutyNow()]);
  return (
    <>
      <PageHeader
        title={`Hello, ${user.displayName}`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/quotes/quick">
                <ZapIcon />
                Quick quote
              </Link>
            </Button>
            <Button asChild>
              <Link href="/quotes/new">
                <FilePlus2Icon />
                New quotation
              </Link>
            </Button>
          </>
        }
      />
      <Card className="gap-2" data-testid="on-duty">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>On duty now</CardTitle>
          <Button asChild size="sm" variant="ghost">
            <Link href="/roster">Roster</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {onDuty.length === 0 ? (
            <p className="text-muted-foreground">Nobody is rostered right now.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {onDuty.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.userName}</span>{" "}
                  <span className="text-muted-foreground">
                    · {e.template.name} · {DUTY_LABELS[e.duty]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Panel title={`Expiring in the next 6 hours (${expiring.length})`}>
        <QuoteTable rows={expiring} showValidity empty="Nothing expiring soon." />
      </Panel>
      <Panel title={`My quotes today (${mine.length})`}>
        <QuoteTable rows={mine} empty="No quotes yet today." />
      </Panel>
      <Panel
        title="Recent quotes"
        action={
          <Button asChild size="sm" variant="ghost">
            <Link href="/quotes">View all</Link>
          </Button>
        }
      >
        <QuoteTable rows={recent} />
      </Panel>
    </>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="gap-2 pb-0">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

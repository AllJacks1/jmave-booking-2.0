import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { embedOrigins, publicBookUrl } from "@/lib/public/host";
import { listReworkDeliveries, reworkStatus, type ReworkDelivery } from "@/lib/rework/leads";
import { getSettings } from "@/lib/settings/service";
import { formatManilaDateTime } from "@/lib/time";
import { EmbedSnippet } from "./embed-snippet";
import { ReworkSettings } from "./rework-settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

function entityHref(d: ReworkDelivery): string | null {
  if (!d.entityId) return null;
  if (d.entity === "inquiry") return `/inquiries/${d.entityId}`;
  if (d.entity === "quotation") return `/quotes/${d.entityId}`;
  if (d.entity === "client") return `/clients/${d.entityId}`;
  return null;
}

export default async function SettingsPage() {
  const { user, allowed } = await requirePage("settings.view");
  if (!allowed) return <NoAccess />;
  const [settings, deliveries] = await Promise.all([getSettings(), listReworkDeliveries(50)]);
  const readOnly = !can(user, "settings.edit");

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          readOnly
            ? "Read-only. Only a Super Admin can change system settings."
            : "Business details, default fuel prices, booking rules and Rework leads."
        }
      />
      <SettingsForm initial={settings} readOnly={readOnly} />
      <div className="flex max-w-5xl flex-col gap-6">
        <ReworkSettings
          initial={{ sendStaffIntakes: settings.rework_send_staff_intakes, optionMap: settings.rework_option_map, dateUnit: settings.rework_date_unit }}
          status={reworkStatus()}
          readOnly={readOnly}
        />
        <Card data-testid="rework-deliveries">
          <CardHeader>
            <CardTitle>Rework deliveries</CardTitle>
            <CardDescription>Last 50 leads sent through the outbox (worker). Failed leads keep their last error.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queued</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No leads yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  deliveries.map((d) => {
                    const href = entityHref(d);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="whitespace-nowrap">{formatManilaDateTime(d.createdAt)}</TableCell>
                        <TableCell>
                          {href ? (
                            <Link href={href} className="text-primary hover:underline">
                              {d.reference ?? d.name ?? "Open"}
                            </Link>
                          ) : (
                            (d.reference ?? d.name ?? "—")
                          )}
                          {d.name && d.reference ? <span className="block text-xs text-muted-foreground">{d.name}</span> : null}
                        </TableCell>
                        <TableCell className="capitalize">{d.source ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={d.status === "sent" ? "secondary" : d.status === "failed" ? "destructive" : "outline"}>{d.status}</Badge>
                          <span className="ml-1 text-xs text-muted-foreground">
                            {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                          </span>
                          {d.lastError ? <span className="block max-w-sm text-xs break-words text-destructive">{d.lastError}</span> : null}
                        </TableCell>
                        <TableCell className="tabular-nums">{d.httpStatus ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{d.sentAt ? formatManilaDateTime(d.sentAt) : "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <EmbedSnippet bookUrl={publicBookUrl(process.env)} origins={embedOrigins(process.env)} />
      </div>
    </>
  );
}

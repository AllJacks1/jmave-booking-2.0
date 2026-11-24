import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatusBadge } from "@/components/bookings/status";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/constants";
import { requirePermissionPage } from "@/lib/bookings/page";
import { BOOKINGS_PAGE_SIZE, listBookings } from "@/lib/bookings/queries";
import { BOOKING_LIST_STATUSES, bookingListSchema } from "@/lib/bookings/schema";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtShortDateTime } from "@/lib/quotes/document";

export const metadata: Metadata = { title: "Bookings" };

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermissionPage();
  const raw = await searchParams;
  const params = bookingListSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined)));
  const { rows, total } = await listBookings(params);
  const pages = Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && k !== "page") p.set(k, String(v));
    }
    p.set("page", String(page));
    return `/bookings?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        description="To add a booking, open an issued quotation and use Convert to booking."
        actions={
          <Button asChild variant="secondary">
            <Link href="/calendar">Calendar</Link>
          </Button>
        }
      />
      <form className="flex flex-wrap items-end gap-3" method="get" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="QTN-2026-929 or client name" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={params.status} className={selectClass}>
            {BOOKING_LIST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All" : s === "open" ? "Open" : BOOKING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service">Service</Label>
          <select id="service" name="service" defaultValue={params.service} className={selectClass}>
            <option value="all">All</option>
            <option value="self_drive">Self-Drive</option>
            <option value="with_driver">With Driver</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={params.from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={params.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("en-PH")} booking{total === 1 ? "" : "s"}
      </p>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Release</TableHead>
              <TableHead>Return</TableHead>
              <TableHead>Service</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No bookings match.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-4 hover:underline" href={`/bookings/${r.id}`}>
                      {r.number}
                    </Link>
                    {r.imported ? <span className="ml-2 text-xs text-muted-foreground">imported</span> : null}
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{r.clientName ?? "—"}</TableCell>
                  <TableCell className="max-w-48 truncate">{r.vehicleName ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtShortDateTime(r.startAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtShortDateTime(r.endAt)}</TableCell>
                  <TableCell>{SERVICE_LABELS[r.service]}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {params.page} of {pages}
          </span>
          {params.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          {params.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

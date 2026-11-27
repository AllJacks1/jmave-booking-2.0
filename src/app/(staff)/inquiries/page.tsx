import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INQUIRY_STATUSES } from "@/db/schema";
import { requireInquiriesPage } from "@/lib/inquiries/page";
import { INQUIRIES_PAGE_SIZE, inquiryListSchema, listInquiries } from "@/lib/inquiries/service";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtPeso } from "@/lib/quotes/document";
import { formatManilaDateTime } from "@/lib/time";
import { INQUIRY_STATUS_LABELS, InquiryStatusBadge } from "./status";

export const metadata: Metadata = { title: "Booking requests" };

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInquiriesPage();
  const q = inquiryListSchema.parse(await searchParams);
  const { rows, total, byStatus } = await listInquiries(q);
  const pages = Math.max(1, Math.ceil(total / INQUIRIES_PAGE_SIZE));
  const href = (status: string, page = 1) => `/inquiries?${new URLSearchParams({ status, ...(page > 1 ? { page: String(page) } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Booking requests"
        description="Requests from the public booking page. Open one to review its draft quotation, then issue it as usual or reject the request."
      />
      <div className="flex flex-wrap gap-2">
        {(["new", "quoted", "converted", "rejected", "all"] as const).map((s) => (
          <Button key={s} asChild size="sm" variant={q.status === s ? "default" : "outline"}>
            <Link href={href(s)}>
              {s === "all" ? "All" : INQUIRY_STATUS_LABELS[s]}
              {s !== "all" ? <span className="ml-1 tabular-nums opacity-70">{byStatus[s]}</span> : null}
            </Link>
          </Button>
        ))}
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Trip</TableHead>
              <TableHead>Car</TableHead>
              <TableHead className="text-right">Shown price</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No {q.status === "all" ? "" : INQUIRY_STATUS_LABELS[q.status as (typeof INQUIRY_STATUSES)[number]].toLowerCase()} requests.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link href={`/inquiries/${r.id}`} className="text-primary hover:underline">
                      {r.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatManilaDateTime(r.createdAt)}</TableCell>
                  <TableCell>
                    {r.clientName ?? "—"}
                    {r.clientBlacklisted ? (
                      <Badge variant="destructive" className="ml-2">
                        Blacklisted
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{SERVICE_LABELS[r.service]}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatManilaDateTime(r.startAt)} → {formatManilaDateTime(r.endAt)}
                  </TableCell>
                  <TableCell>{r.vehicleName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.shownTotalCentavos !== null ? fmtPeso(r.shownTotalCentavos) : "—"}</TableCell>
                  <TableCell>
                    <InquiryStatusBadge status={r.status} />
                    {r.quotationNumber ? <span className="ml-2 text-xs text-muted-foreground">{r.quotationNumber}</span> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          {q.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={href(q.status, q.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          <span>
            Page {q.page} of {pages}
          </span>
          {q.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={href(q.status, q.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

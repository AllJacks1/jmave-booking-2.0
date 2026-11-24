import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableRow } from "@/components/ui/table";
import type { ImportedQuotationData } from "@/lib/bookings/charges";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/bookings/constants";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtDateTime, fmtPeso } from "@/lib/quotes/document";
import type { QuotationView } from "@/lib/quotes/service";
import { QuoteActions } from "./quote-actions";

/** Read-only view of a quotation imported from the old rental logs (Phase 2a). */
export function ImportedQuote({
  q,
  booking,
  canConvert,
}: {
  q: QuotationView;
  booking: { id: string; number: string } | null;
  canConvert: boolean;
}) {
  const d = (q.importedData ?? null) as ImportedQuotationData | null;
  const snap = (q.snapshot ?? {}) as { vehicleName?: string | null; consultantName?: string | null };
  return (
    <>
      <PageHeader
        title={q.number ?? "Quotation"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <QuoteStatusBadge status={q.effective} kind="formal" />
            {q.clientName ?? "No client"} · {SERVICE_LABELS[q.service]} · imported from {d?.source ?? "the rental log"}
          </span>
        }
      />
      <QuoteActions id={q.id} status={q.effective} shareToken={null} text="" booking={booking} canConvert={canConvert} hasVehicle={Boolean(q.vehicleId)} imported />
      <Alert>
        <AlertTitle>Imported quotation</AlertTitle>
        <AlertDescription>
          Logged amounts from the old workbook. No PDF or revision; make a new quotation to quote again.
          {!q.vehicleId && q.effective === "issued" ? " The car was not matched to a vehicle, so it cannot be converted." : ""}
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Logged lines</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableBody>
                {(d?.lines ?? []).map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">{l.label}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{fmtPeso(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-6">Total</TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">{d?.total !== null && d?.total !== undefined ? fmtPeso(d.total) : "—"}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Info label="Travel" value={q.startAt ? `${fmtDateTime(q.startAt)}${q.endAt ? ` → ${fmtDateTime(q.endAt)}` : ""}` : "—"} />
            <Info label="Car (logged)" value={d?.vehicleText ?? "—"} />
            <Info label="Vehicle" value={snap.vehicleName && q.vehicleId ? snap.vehicleName : "Not matched"} />
            <Info label="Category" value={d?.category ?? "—"} />
            <Info label="Destination" value={d?.destination ?? "—"} />
            <Info label="Reservation fee" value={d?.reservationFee ? fmtPeso(d.reservationFee) : "—"} />
            <Info label="Deposit" value={d?.deposit ? fmtPeso(d.deposit) : "—"} />
            <Info label="Payment" value={d ? (PAYMENT_METHOD_LABELS[d.paymentMethod as PaymentMethod] ?? d.paymentMethod) : "—"} />
            <Info label="Sales" value={snap.consultantName ?? "—"} />
            <Info label="Logged status" value={d?.status ?? "—"} />
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

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SERVICE_LABELS, type BodyType, type Category } from "@/lib/pricing";
import { bodyLabel, fmtDateTime, fmtPeso, fmtShortDateTime, type EffectiveStatus } from "@/lib/quotes/document";
import { QuoteStatusBadge } from "./status-badge";

export type QuoteTableRow = {
  id: string;
  number: string | null;
  kind: "quick" | "formal";
  service: "self_drive" | "with_driver";
  effective: EffectiveStatus;
  clientName: string | null;
  bodyType: BodyType | null;
  category: string | null;
  startAt: Date | null;
  totalCentavos: number | null;
  validUntil: Date | null;
  createdAt: Date;
  consultantName: string | null;
};

export function QuoteTable({
  rows,
  empty = "No quotations.",
  showValidity = false,
}: {
  rows: QuoteTableRow[];
  empty?: string;
  showValidity?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Quotation</TableHead>
          <TableHead>Client</TableHead>
          <TableHead className="hidden md:table-cell">Service · vehicle</TableHead>
          <TableHead className="hidden lg:table-cell">{showValidity ? "Valid until" : "Start"}</TableHead>
          <TableHead className="hidden sm:table-cell">Consultant</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((q) => (
          <TableRow key={q.id} data-testid="quote-row">
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/quotes/${q.id}`} className="font-medium underline-offset-4 hover:underline">
                  {q.number ?? (q.kind === "quick" ? "Estimate" : "Draft")}
                </Link>
                <QuoteStatusBadge status={q.effective} kind={q.kind} />
              </div>
              <div className="text-xs text-muted-foreground">{fmtDateTime(q.createdAt)}</div>
            </TableCell>
            <TableCell className="max-w-48 truncate">{q.clientName ?? "—"}</TableCell>
            <TableCell className="hidden md:table-cell">
              {SERVICE_LABELS[q.service]}
              {q.bodyType ? ` · ${bodyLabel(q.bodyType, (q.category as Category | null) ?? null)}` : ""}
            </TableCell>
            <TableCell className="hidden whitespace-nowrap lg:table-cell">
              {showValidity
                ? q.validUntil
                  ? fmtShortDateTime(q.validUntil)
                  : "—"
                : q.startAt
                  ? fmtShortDateTime(q.startAt)
                  : "—"}
            </TableCell>
            <TableCell className="hidden sm:table-cell">{q.consultantName ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{q.totalCentavos === null ? "—" : fmtPeso(q.totalCentavos)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

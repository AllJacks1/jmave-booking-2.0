import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LedgerEntry } from "@/lib/loyalty/service";
import { POINTS_KIND_LABELS } from "@/lib/loyalty/schema";
import { formatManilaDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Points history, newest first, with the balance after each entry. */
export function PointsHistory({ entries, linkBookings }: { entries: LedgerEntry[]; linkBookings: boolean }) {
  return (
    <Table data-testid="points-history">
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
              No points yet.
            </TableCell>
          </TableRow>
        ) : null}
        {entries.map((e) => (
          <TableRow key={e.id} data-testid="points-entry">
            <TableCell className="whitespace-nowrap">{formatManilaDate(e.occurredAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{POINTS_KIND_LABELS[e.kind]}</TableCell>
            <TableCell className="text-sm whitespace-normal">
              {e.bookingId && e.bookingNumber && linkBookings ? (
                <Link href={`/bookings/${e.bookingId}`} className="underline-offset-4 hover:underline">
                  {e.bookingNumber}
                </Link>
              ) : null}
              {e.note && !(e.bookingNumber && e.note.startsWith(`${e.bookingNumber}:`)) ? <span> {e.note}</span> : null}
              {e.note && e.bookingNumber && e.note.startsWith(`${e.bookingNumber}:`) ? <span>{e.note.slice(e.bookingNumber.length)}</span> : null}
              {e.createdByName ? <span className="text-muted-foreground"> · {e.createdByName}</span> : null}
            </TableCell>
            <TableCell className={cn("text-right tabular-nums", e.points < 0 && "text-destructive")}>
              {e.points > 0 ? "+" : ""}
              {e.points.toLocaleString("en-PH")}
            </TableCell>
            <TableCell className="text-right tabular-nums">{e.running.toLocaleString("en-PH")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

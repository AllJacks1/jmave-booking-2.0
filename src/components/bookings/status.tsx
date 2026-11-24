import { Badge } from "@/components/ui/badge";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/bookings/constants";
import { cn } from "@/lib/utils";

/** Bar / badge colours by status (bookings-and-movement.md §4). Pending is striped. */
export const STATUS_CLASSES: Record<BookingStatus | "block", string> = {
  pending_reservation:
    "border-amber-500 text-amber-950 dark:text-amber-50 bg-[repeating-linear-gradient(135deg,var(--color-amber-200)_0_6px,var(--color-amber-100)_6px_12px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-amber-800)_0_6px,var(--color-amber-950)_6px_12px)]",
  confirmed: "border-sky-600 bg-sky-600 text-white",
  released: "border-emerald-600 bg-emerald-600 text-white",
  returned: "border-violet-600 bg-violet-600 text-white",
  closed: "border-slate-400 bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  cancelled: "border-border bg-background text-muted-foreground line-through",
  no_show: "border-border bg-background text-muted-foreground line-through",
  block: "border-zinc-500 bg-zinc-400 text-zinc-950 dark:bg-zinc-600 dark:text-zinc-50",
};

export function BookingStatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_CLASSES[status], className)} data-testid="booking-status">
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

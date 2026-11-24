import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { availabilityMessage, type Availability } from "@/lib/bookings/format";
import { cn } from "@/lib/utils";

/** "Available" / "Overlaps pending reservation QTN-…" (warning) / "Booked by QTN-…" (error). */
export function AvailabilityNote({ availability, className }: { availability: Availability | null; className?: string }) {
  if (!availability) return null;
  const { state } = availability;
  const Icon = state === "available" ? CheckCircle2Icon : state === "pending_overlap" ? AlertTriangleIcon : XCircleIcon;
  return (
    <p
      role="status"
      data-testid="availability-note"
      data-state={state}
      className={cn(
        "flex items-center gap-2 text-sm",
        state === "available" && "text-emerald-700 dark:text-emerald-400",
        state === "pending_overlap" && "text-amber-700 dark:text-amber-400",
        state === "booked" && "text-destructive",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      {availabilityMessage(availability)}
      {state === "booked" && availability.pending.length ? ` · also pending ${availability.pending.map((p) => p.number).join(", ")}` : null}
    </p>
  );
}

"use client";

import { BanIcon, CheckCircle2Icon, LockIcon, UserXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingEvent } from "@/lib/booking-status";
import { availabilityMessage, type Availability } from "@/lib/bookings/format";
import { cancelBookingAction, closeBookingAction, confirmBookingAction, noShowAction } from "../actions";

type Dialogs = "confirm" | "cancel" | "no_show" | null;

export function BookingActions({
  id,
  events,
  hasReservationFee,
  canConfirmWithoutRf,
  availability,
}: {
  id: string;
  events: BookingEvent[];
  hasReservationFee: boolean;
  canConfirmWithoutRf: boolean;
  availability: Availability | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Dialogs>(null);
  const [reason, setReason] = useState("");
  const [withoutRf, setWithoutRf] = useState(false);

  async function run(f: () => Promise<{ ok: true } | { ok: false; error: string }>, msg: string) {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(msg);
    setOpen(null);
    setReason("");
    router.refresh();
  }

  const show = (d: Dialogs) => {
    setReason("");
    setWithoutRf(false);
    setOpen(d);
  };

  if (events.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {events.includes("confirm") ? (
        <Button onClick={() => show("confirm")} disabled={busy}>
          <CheckCircle2Icon />
          Confirm booking
        </Button>
      ) : null}
      {events.includes("close") ? (
        <Button onClick={() => run(() => closeBookingAction({ id }), "Booking closed")} disabled={busy}>
          <LockIcon />
          Close booking
        </Button>
      ) : null}
      {events.includes("no_show") ? (
        <Button variant="outline" onClick={() => show("no_show")} disabled={busy}>
          <UserXIcon />
          No-show
        </Button>
      ) : null}
      {events.includes("cancel") ? (
        <Button variant="outline" onClick={() => show("cancel")} disabled={busy}>
          <BanIcon />
          Cancel booking
        </Button>
      ) : null}

      <Dialog open={open === "confirm"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm booking</DialogTitle>
            <DialogDescription>Confirming reserves the car for this schedule. Nobody else can confirm it for an overlapping time.</DialogDescription>
          </DialogHeader>
          {availability && availability.state !== "available" ? (
            <p className={availability.state === "booked" ? "text-sm text-destructive" : "text-sm text-amber-700 dark:text-amber-400"}>
              {availabilityMessage(availability)}
            </p>
          ) : null}
          {hasReservationFee ? (
            <p className="text-sm">Reservation fee received.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">No reservation fee payment is recorded yet. Add it in Payments first.</p>
              {canConfirmWithoutRf ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={withoutRf} onCheckedChange={(v) => setWithoutRf(v === true)} />
                    Confirm without reservation fee
                  </label>
                  {withoutRf ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="rf-reason">Reason</Label>
                      <Textarea id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={busy || (!hasReservationFee && (!withoutRf || !reason.trim()))}
              onClick={() => run(() => confirmBookingAction({ id, withoutRf, withoutRfReason: reason.trim() }), "Booking confirmed")}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "cancel" || open === "no_show"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open === "cancel" ? "Cancel booking" : "Mark as no-show"}</DialogTitle>
            <DialogDescription>This frees the car for other bookings.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status-reason">{open === "cancel" ? "Reason" : "Note (optional)"}</Label>
            <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy || (open === "cancel" && !reason.trim())}
              onClick={() =>
                open === "cancel"
                  ? run(() => cancelBookingAction({ id, reason: reason.trim() }), "Booking cancelled")
                  : run(() => noShowAction({ id, reason: reason.trim() }), "Marked as no-show")
              }
            >
              {open === "cancel" ? "Cancel booking" : "Mark no-show"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { ClockPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtPeso } from "@/lib/quotes/document";
import { extendBookingAction, previewExtensionAction } from "../actions";

/** Extend the return time of a confirmed/released booking (Sales+). */
export function ExtendDialog({ bookingId, endDate, endTime, endText }: { bookingId: string; endDate: string; endTime: string; endText: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(endDate);
  const [time, setTime] = useState(endTime);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<{ hours: number; amount: number; remark: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      const r = await previewExtensionAction({ bookingId, newEndDate: date, newEndTime: time });
      if (stale) return;
      if (r.ok) {
        setPrice(r.data);
        setError(null);
      } else {
        setPrice(null);
        setError(r.error);
      }
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [open, bookingId, date, time]);

  async function save() {
    setBusy(true);
    const r = await extendBookingAction({ bookingId, newEndDate: date, newEndTime: time, note });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Extended by ${r.data.hours} h`);
    setOpen(false);
    setNote("");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ClockPlusIcon />
        Extend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend booking</DialogTitle>
            <DialogDescription>Now due back {endText}. Extra hours are charged at the hourly rate; the car stays held until the new time.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ext-date">New return date</Label>
              <Input id="ext-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ext-time">New return time</Label>
              <Input id="ext-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="ext-note">Note</Label>
              <Textarea id="ext-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <p className="text-sm" data-testid="extension-price">
            {price ? (
              <>
                {price.hours} h · {price.remark} → <span className="font-semibold">{fmtPeso(price.amount)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{error ?? "…"}</span>
            )}
          </p>
          <DialogFooter>
            <Button onClick={save} disabled={busy || !price || price.hours === 0}>
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

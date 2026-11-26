"use client";

import { Undo2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { undoReturnAction } from "../actions";

/** Admin+: put a returned booking back to released (removes the return check-in, its charges and points). */
export function UndoReturnButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await undoReturnAction({ bookingId, reason });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    const pts = r.data.pointsReversed ? `, ${r.data.pointsReversed.toLocaleString("en-PH")} points taken back` : "";
    toast.success(`Return undone (${r.data.chargesRemoved} check-in charge${r.data.chargesRemoved === 1 ? "" : "s"} removed${pts}).`);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2Icon />
        Undo return
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo the return</DialogTitle>
            <DialogDescription>
              The booking goes back to Released. The return check-in and the charges it added are removed, the car is held until the planned
              return again, and the loyalty points it earned are taken back.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="undo-reason">Reason</Label>
            <Textarea id="undo-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={busy || !reason.trim()} onClick={submit}>
              Undo return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

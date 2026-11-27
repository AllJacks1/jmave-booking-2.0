"use client";

import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rejectInquiryAction } from "../actions";

export function RejectInquiry({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function reject() {
    setBusy(true);
    const r = await rejectInquiryAction({ id, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setOpen(false);
    toast.success("Request rejected");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <XIcon />
        Reject
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>A draft quotation for this request is cancelled with it. The client is not notified automatically.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button disabled={!reason.trim() || busy} onClick={reject}>
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

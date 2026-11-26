"use client";

import { CalendarCheckIcon, CalendarPlusIcon, CheckIcon, ClipboardCopyIcon, FileDownIcon, LinkIcon, PencilIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EffectiveStatus } from "@/lib/quotes/document";
import { convertToBookingAction } from "../../bookings/actions";
import { markAcceptedAction, markLostAction, reviseQuotationAction } from "../actions";

/** Actions on an issued (read-only) quotation. */
export function QuoteActions({
  id,
  status,
  shareToken,
  text,
  booking,
  canConvert,
  hasVehicle,
  imported = false,
  extra,
}: {
  id: string;
  status: EffectiveStatus;
  shareToken: string | null;
  text: string;
  booking: { id: string; number: string } | null;
  canConvert: boolean;
  hasVehicle: boolean;
  /** Imported history quotation: no PDF, share link, copy text or revise. */
  imported?: boolean;
  /** More buttons (e.g. Send by email). */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState("");
  const open = status === "issued";
  const revisable = !imported && status !== "cancelled" && status !== "draft";

  async function act<T>(f: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (d: T) => void) {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    done(r.data);
  }

  const copy = async (value: string, msg: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(msg);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {booking ? (
        <Button asChild>
          <Link href={`/bookings/${booking.id}`}>
            <CalendarCheckIcon />
            Open booking
          </Link>
        </Button>
      ) : null}
      {(open || status === "accepted") && canConvert && !booking ? (
        <Button
          disabled={busy || !hasVehicle}
          title={hasVehicle ? undefined : "Revise the quotation and choose a specific vehicle first"}
          onClick={() =>
            act(
              () => convertToBookingAction({ quotationId: id }),
              (d) => {
                toast.success(`Booking ${d.number} created`);
                router.push(`/bookings/${d.id}`);
              },
            )
          }
        >
          <CalendarPlusIcon />
          Convert to booking
        </Button>
      ) : null}
      {imported ? null : (
        <>
      <Button asChild variant={booking || (open && canConvert) ? "secondary" : "default"}>
        <a href={`/api/quotations/${id}/pdf`} download>
          <FileDownIcon />
          PDF
        </a>
      </Button>
      {shareToken ? (
        <Button variant="secondary" onClick={() => copy(`${window.location.origin}/q/${shareToken}`, "Share link copied")}>
          <LinkIcon />
          Copy share link
        </Button>
      ) : null}
      <Button variant="secondary" onClick={() => copy(text, "Copied. Paste it into Messenger or WhatsApp.")}>
        <ClipboardCopyIcon />
        Copy text
      </Button>
        </>
      )}
      {extra}
      {revisable ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => act(() => reviseQuotationAction({ id }), (d) => router.push(`/quotes/${d.id}`))}
        >
          <PencilIcon />
          Revise
        </Button>
      ) : null}
      {open ? (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(
                () => markAcceptedAction({ id }),
                () => {
                  toast.success("Marked accepted");
                  router.refresh();
                },
              )
            }
          >
            <CheckIcon />
            Mark accepted
          </Button>
        </>
      ) : null}
      {open || status === "expired" ? (
        <Button variant="outline" disabled={busy} onClick={() => setLostOpen(true)}>
          <XIcon />
          Mark lost
        </Button>
      ) : null}
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
            <DialogDescription>Why did the client not go ahead?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lost-reason">Reason</Label>
            <Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button
              disabled={!reason.trim() || busy}
              onClick={() =>
                act(
                  () => markLostAction({ id, reason: reason.trim() }),
                  () => {
                    setLostOpen(false);
                    toast.success("Marked lost");
                    router.refresh();
                  },
                )
              }
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

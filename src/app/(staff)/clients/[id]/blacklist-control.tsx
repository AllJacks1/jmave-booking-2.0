"use client";

import { BanIcon, CircleCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { setBlacklistAction } from "../actions";

/** Admin+: blacklist with a reason, or clear it. */
export function BlacklistControl({ id, name, blacklisted, reason }: { id: string; name: string; blacklisted: boolean; reason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(nextBlacklisted: boolean) {
    setError(null);
    start(async () => {
      const r = await setBlacklistAction({ id, blacklisted: nextBlacklisted, reason: nextBlacklisted ? text : "" });
      if (!r.ok) {
        setError(r.fieldErrors?.reason?.[0] ?? r.error);
        return;
      }
      toast.success(nextBlacklisted ? `${name} blacklisted` : `${name} removed from the blacklist`);
      setOpen(false);
      router.refresh();
    });
  }

  if (blacklisted) {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => confirm(`Remove ${name} from the blacklist?`) && submit(false)}
      >
        <CircleCheckIcon />
        Clear blacklist
      </Button>
    );
  }
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <BanIcon />
        Blacklist
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Blacklist {name}</DialogTitle>
            <DialogDescription>Staff see a Blacklisted badge wherever this client appears.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="reason">Reason</FieldLabel>
            <Textarea id="reason" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error} />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => submit(true)}>
              {pending ? "Saving…" : "Blacklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

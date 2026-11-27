"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sendClientToReworkAction } from "../actions";

/** Manual "Send to Rework" (rework.md §2, Sales+). Once sent, the button says "Send again". */
export function SendToRework({ id, sentAt }: { id: string; sentAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function send() {
    if (sentAt && !window.confirm(`This client was sent to Rework on ${sentAt}. Send another lead?`)) return;
    setBusy(true);
    const r = await sendClientToReworkAction({ id, again: Boolean(sentAt) });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Lead queued for Rework");
    router.refresh();
  }
  const button = (
    <Button variant="outline" disabled={busy} onClick={send}>
      <SendIcon />
      {sentAt ? "Send to Rework again" : "Send to Rework"}
    </Button>
  );
  if (!sentAt) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>Sent {sentAt}</TooltipContent>
    </Tooltip>
  );
}

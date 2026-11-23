"use client";

import { CopyIcon, PencilIcon, ZapIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { activateRateCardAction, createDraftAction } from "./actions";

type Card = { id: string; version: number; name: string; status: "draft" | "active" | "archived" };

/** Super Admin buttons for one card: edit (drafts), new draft from it, activate. */
export function CardActions({ card, size = "sm" }: { card: Card; size?: "sm" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function copy() {
    const name = prompt("Name for the new draft", `Draft from v${card.version}`);
    if (!name) return;
    start(async () => {
      const r = await createDraftAction({ fromId: card.id, name });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Draft v${r.data.version} created`);
      router.push(`/rates/${r.data.id}/edit`);
    });
  }

  function activate() {
    if (!confirm(`Activate v${card.version}? The current active card is archived. New quotations use v${card.version} from now on.`)) return;
    start(async () => {
      const r = await activateRateCardAction({ id: card.id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`v${card.version} is now active`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {card.status === "draft" ? (
        <Button asChild variant="outline" size={size}>
          <Link href={`/rates/${card.id}/edit`}>
            <PencilIcon />
            Edit
          </Link>
        </Button>
      ) : null}
      <Button variant="outline" size={size} onClick={copy} disabled={pending}>
        <CopyIcon />
        New draft
      </Button>
      {card.status !== "active" ? (
        <Button size={size} onClick={activate} disabled={pending}>
          <ZapIcon />
          Activate
        </Button>
      ) : null}
    </div>
  );
}

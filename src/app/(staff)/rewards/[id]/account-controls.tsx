"use client";

import { LinkIcon, CoinsIcon, TagIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientPicker, type PickedClient } from "../../quotes/client-picker";
import { adjustPointsAction, linkClientAction, setTierAction } from "../actions";

type Open = "adjust" | "tier" | "link" | null;

/** Manual adjustment (Admin+), tier (Super Admin), link an unmatched card (Admin+). */
export function AccountControls({
  accountId,
  balance,
  tier,
  linked,
  canAdjust,
  canEditTier,
}: {
  accountId: string;
  balance: number;
  tier: number | null;
  linked: boolean;
  canAdjust: boolean;
  canEditTier: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [tierText, setTierText] = useState(tier === null ? "" : String(tier));
  const [client, setClient] = useState<PickedClient | null>(null);

  const show = (o: Open) => {
    setError(null);
    setPoints("");
    setReason("");
    setTierText(tier === null ? "" : String(tier));
    setClient(null);
    setOpen(o);
  };

  async function run(f: () => Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }>, msg: string) {
    setBusy(true);
    setError(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) {
      setError(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
      return;
    }
    toast.success(msg);
    setOpen(null);
    router.refresh();
  }

  const pts = Number(points);
  const pointsValid = points.trim() !== "" && Number.isInteger(pts) && pts !== 0;

  if (!canAdjust && !canEditTier) return null;
  return (
    <>
      {canAdjust ? (
        <Button variant="outline" onClick={() => show("adjust")}>
          <CoinsIcon />
          Adjust points
        </Button>
      ) : null}
      {canEditTier ? (
        <Button variant="outline" onClick={() => show("tier")}>
          <TagIcon />
          Set tier
        </Button>
      ) : null}
      {canAdjust && !linked ? (
        <Button onClick={() => show("link")}>
          <LinkIcon />
          Link client
        </Button>
      ) : null}

      <Dialog open={open === "adjust"} onOpenChange={(o) => setOpen(o ? "adjust" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust points</DialogTitle>
            <DialogDescription>Current balance {balance.toLocaleString("en-PH")} points. Use a negative number to take points away.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="adjust-points">Points (+ or −)</Label>
              <Input id="adjust-points" type="number" step="1" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adjust-reason">Reason</Label>
              <Textarea id="adjust-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !pointsValid || !reason.trim()}
              onClick={() => run(() => adjustPointsAction({ accountId, points: pts, reason }), "Points adjusted")}
            >
              Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "tier"} onOpenChange={(o) => setOpen(o ? "tier" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set tier</DialogTitle>
            <DialogDescription>Leave empty for no tier.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tier">Tier</Label>
            <Input id="tier" type="number" min={0} max={99} step="1" value={tierText} onChange={(e) => setTierText(e.target.value)} />
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => run(() => setTierAction({ accountId, tier: tierText.trim() === "" ? null : Number(tierText) }), "Tier saved")}
            >
              Save tier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "link"} onOpenChange={(o) => setOpen(o ? "link" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to a client</DialogTitle>
            <DialogDescription>The card and its points move to this client. A client can have only one card.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <ClientPicker value={client} onChange={setClient} />
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button disabled={busy || !client} onClick={() => client && run(() => linkClientAction({ accountId, clientId: client.id }), "Card linked")}>
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

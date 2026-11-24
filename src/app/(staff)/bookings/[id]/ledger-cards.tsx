"use client";

import { PlusIcon, Trash2Icon, Undo2Icon, WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/actions";
import {
  CHARGE_KIND_LABELS,
  CHARGE_KINDS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_TYPE_DIRECTION,
  PAYMENT_TYPE_LABELS,
  PAYMENT_TYPES,
  type ChargeKind,
  type PaymentDirection,
  type PaymentMethod,
  type PaymentType,
} from "@/lib/bookings/constants";
import type { Ledger } from "@/lib/bookings/ledger";
import { parsePesoToCentavos } from "@/lib/money";
import { fmtPeso, fmtShortDateTime } from "@/lib/quotes/document";
import { manilaDateKey, manilaTime } from "@/lib/time";
import { addChargeAction, addPaymentAction, applyDepositAction, removeChargeAction, voidPaymentAction } from "../actions";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

type Result = { ok: true } | ActionFailure;

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(f: () => Promise<Result>, msg: string, done?: () => void) {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok) {
      const first = Object.values(r.fieldErrors ?? {})[0]?.[0];
      toast.error(first ? `${r.error} ${first}` : r.error);
      return;
    }
    toast.success(msg);
    done?.();
    router.refresh();
  }
  return { busy, run };
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

type ChargeRow = { id: string; kind: ChargeKind; label: string; amountCentavos: number; source: "quote" | "check_in" | "manual" };

export function ChargesCard({ bookingId, charges, ledger, open }: { bookingId: string; charges: ChargeRow[]; ledger: Ledger; open: boolean }) {
  const { busy, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ChargeKind>("other");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [removing, setRemoving] = useState<ChargeRow | null>(null);
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Charges</CardTitle>
        {open ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add charge
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Item</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10 pr-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="pl-6 text-muted-foreground">
                  No charges.
                </TableCell>
              </TableRow>
            ) : (
              charges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-6 whitespace-normal">
                    {c.label}
                    {c.kind !== "quoted" ? <span className="ml-2 text-xs text-muted-foreground">{CHARGE_KIND_LABELS[c.kind]}</span> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.source === "quote" ? "Quote" : c.source === "check_in" ? "Check-in" : "Manual"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPeso(c.amountCentavos)}</TableCell>
                  <TableCell className="pr-6">
                    {open && c.source === "manual" ? (
                      <Button size="icon" variant="ghost" aria-label="Remove charge" onClick={() => setRemoving(c)}>
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="pl-6">
                Total charges
              </TableCell>
              <TableCell className="text-right tabular-nums" data-testid="charges-total">
                {fmtPeso(ledger.charges)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add charge</DialogTitle>
            <DialogDescription>Use a negative amount for a credit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="charge-kind">Kind</Label>
              <select id="charge-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)}>
                {CHARGE_KINDS.filter((k) => k !== "quoted").map((k) => (
                  <option key={k} value={k}>
                    {CHARGE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="charge-label">Description</Label>
              <Input id="charge-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="charge-amount">Amount (₱)</Label>
              <Input id="charge-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                const neg = amount.trim().startsWith("-");
                const c = parsePesoToCentavos(amount.replace("-", ""));
                if (c === null || c === 0) return void toast.error("Enter an amount.");
                run(
                  () => addChargeAction({ bookingId, kind, label: label.trim(), amountCentavos: neg ? -c : c }),
                  "Charge added",
                  () => {
                    setAdding(false);
                    setLabel("");
                    setAmount("");
                  },
                );
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove charge</DialogTitle>
            <DialogDescription>{removing ? `${removing.label} · ${fmtPeso(removing.amountCentavos)}` : null}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="remove-reason">Reason</Label>
            <Textarea id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() =>
                removing &&
                run(() => removeChargeAction({ id: removing.id, reason: reason.trim() }), "Charge removed", () => {
                  setRemoving(null);
                  setReason("");
                })
              }
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payments ledger
// ---------------------------------------------------------------------------

type PaymentRow = {
  id: string;
  type: PaymentType;
  direction: PaymentDirection;
  amountCentavos: number;
  method: PaymentMethod;
  reference: string | null;
  collectorLabel: string;
  paidAt: string;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
};

const emptyPayment = () => {
  const now = new Date();
  return {
    type: "reservation_fee" as PaymentType,
    direction: "in" as PaymentDirection,
    amount: "",
    method: "gcash" as PaymentMethod,
    reference: "",
    collector: "",
    collectorName: "",
    paidDate: manilaDateKey(now),
    paidTime: manilaTime(now),
    note: "",
  };
};

export function PaymentsCard({
  bookingId,
  payments,
  ledger,
  open,
  canVoid,
  staff,
  meId,
}: {
  bookingId: string;
  payments: PaymentRow[];
  ledger: Ledger;
  open: boolean;
  canVoid: boolean;
  staff: { id: string; name: string }[];
  meId: string;
}) {
  const { busy, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => ({ ...emptyPayment(), collector: meId }));
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyAmount, setApplyAmount] = useState("");
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const fixedDirection = PAYMENT_TYPE_DIRECTION[form.type];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        {open ? (
          <CardAction className="flex gap-2">
            {ledger.depositHeld > 0 && ledger.balance > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setApplyAmount(String(Math.min(ledger.depositHeld, ledger.balance) / 100));
                  setApplying(true);
                }}
              >
                <WalletIcon />
                Apply deposit
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                setForm({ ...emptyPayment(), collector: meId });
                setAdding(true);
              }}
            >
              <PlusIcon />
              Add payment
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <dl className="grid grid-cols-2 gap-3 px-6 text-sm sm:grid-cols-4">
          <Stat label="Charges" value={fmtPeso(ledger.charges)} />
          <Stat label="Paid (net)" value={fmtPeso(ledger.paidIn - ledger.paidOut)} />
          <Stat label="Balance" value={fmtPeso(ledger.balance)} strong testId="balance" />
          <Stat label="Deposit held" value={fmtPeso(ledger.depositHeld)} strong testId="deposit-held" />
        </dl>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10 pr-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="pl-6 text-muted-foreground">
                  No payments yet.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id} className={p.voidedAt ? "text-muted-foreground line-through" : undefined} data-testid="payment-row">
                  <TableCell className="pl-6 whitespace-nowrap">{fmtShortDateTime(new Date(p.paidAt))}</TableCell>
                  <TableCell className="whitespace-normal">
                    {PAYMENT_TYPE_LABELS[p.type]}
                    {p.reference ? <span className="block text-xs text-muted-foreground">Ref {p.reference}</span> : null}
                    {p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}
                    {p.voidedAt ? (
                      <span className="block text-xs no-underline">
                        Void: {p.voidReason} ({p.voidedByName ?? "—"})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                  <TableCell className="max-w-32 truncate">{p.collectorLabel}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPeso(p.direction === "out" ? -p.amountCentavos : p.amountCentavos)}</TableCell>
                  <TableCell className="pr-6">
                    {canVoid && !p.voidedAt ? (
                      <Button size="icon" variant="ghost" aria-label="Void payment" onClick={() => setVoiding(p)}>
                        <Undo2Icon />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add payment</DialogTitle>
            <DialogDescription>Entries cannot be edited. Admin can void a wrong entry.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-type">Type</Label>
              <select id="pay-type" className={selectClass} value={form.type} onChange={(e) => set("type", e.target.value as PaymentType)}>
                {PAYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAYMENT_TYPE_LABELS[t]} ({PAYMENT_TYPE_DIRECTION[t] ?? "in/out"})
                  </option>
                ))}
              </select>
            </div>
            {fixedDirection === null ? (
              <div className="grid gap-1.5">
                <Label htmlFor="pay-direction">Direction</Label>
                <select id="pay-direction" className={selectClass} value={form.direction} onChange={(e) => set("direction", e.target.value as PaymentDirection)}>
                  <option value="in">In (received)</option>
                  <option value="out">Out (paid back)</option>
                </select>
              </div>
            ) : (
              <div />
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="pay-amount">Amount (₱)</Label>
              <Input id="pay-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <select id="pay-method" className={selectClass} value={form.method} onChange={(e) => set("method", e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-ref">Reference no.</Label>
              <Input id="pay-ref" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-collector">{fixedDirection === "out" ? "Paid by" : "Collected by"}</Label>
              <select id="pay-collector" className={selectClass} value={form.collector} onChange={(e) => set("collector", e.target.value)}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">Someone else (type name)</option>
              </select>
            </div>
            {form.collector === "" ? (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="pay-collector-name">Name (e.g. a driver)</Label>
                <Input id="pay-collector-name" value={form.collectorName} onChange={(e) => set("collectorName", e.target.value)} />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="pay-date">Date</Label>
              <Input id="pay-date" type="date" value={form.paidDate} onChange={(e) => set("paidDate", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-time">Time</Label>
              <Input id="pay-time" type="time" value={form.paidTime} onChange={(e) => set("paidTime", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pay-note">Note</Label>
              <Input id="pay-note" value={form.note} onChange={(e) => set("note", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                const c = parsePesoToCentavos(form.amount);
                if (c === null || c <= 0) return void toast.error("Enter an amount.");
                run(
                  () =>
                    addPaymentAction({
                      bookingId,
                      type: form.type,
                      direction: form.direction,
                      amountCentavos: c,
                      method: form.method,
                      reference: form.reference,
                      collectedByUserId: form.collector || null,
                      collectedByName: form.collector ? "" : form.collectorName,
                      paidDate: form.paidDate,
                      paidTime: form.paidTime,
                      note: form.note,
                    }),
                  "Payment added",
                  () => setAdding(false),
                );
              }}
            >
              Add payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void payment</DialogTitle>
            <DialogDescription>
              {voiding ? `${PAYMENT_TYPE_LABELS[voiding.type]} · ${fmtPeso(voiding.amountCentavos)}. The entry stays in the ledger, crossed out.` : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() =>
                voiding &&
                run(() => voidPaymentAction({ id: voiding.id, reason: reason.trim() }), "Payment voided", () => {
                  setVoiding(null);
                  setReason("");
                })
              }
            >
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={applying} onOpenChange={setApplying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply deposit to balance</DialogTitle>
            <DialogDescription>
              Records a deposit refund and a matching rental payment. Deposit held {fmtPeso(ledger.depositHeld)}, balance {fmtPeso(ledger.balance)}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="apply-amount">Amount (₱)</Label>
            <Input id="apply-amount" inputMode="decimal" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                const c = parsePesoToCentavos(applyAmount);
                if (c === null || c <= 0) return void toast.error("Enter an amount.");
                run(() => applyDepositAction({ bookingId, amountCentavos: c }), "Deposit applied", () => setApplying(false));
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground uppercase">{label}</dt>
      <dd className={strong ? "text-base font-semibold tabular-nums" : "tabular-nums"} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

"use client";

import { MailIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/quotes/document";
import type { Delivery } from "@/lib/quotes/email";
import { sendQuotationEmailAction } from "../actions";

/** "Send by email" (Sales+): the worker sends it with the PDF attached. */
export function SendEmailButton({ id, defaultTo }: { id: string; defaultTo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await sendQuotationEmailAction({ id, to, message });
    setBusy(false);
    if (!r.ok) {
      setError(r.fieldErrors?.to?.[0] ?? r.error);
      return;
    }
    setOpen(false);
    setMessage("");
    toast.success("Email queued. Its delivery status shows below.");
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <MailIcon />
        Send by email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send by email</DialogTitle>
            <DialogDescription>The quotation PDF is attached. The email is sent in the background.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-to">Recipient</Label>
              <Input id="email-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={Boolean(error)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-message">Message (optional)</Label>
              <Textarea id="email-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button disabled={busy || !to.trim()} onClick={send}>
              <MailIcon />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const STATUS: Record<Delivery["status"], { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pending: { label: "Sending", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

/** Delivery status of the quotation's emails. Refreshes while one is still pending. */
export function DeliveriesCard({ deliveries }: { deliveries: Delivery[] }) {
  const router = useRouter();
  const pending = deliveries.some((d) => d.status === "pending");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [pending, router]);
  return (
    <Card data-testid="deliveries">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Emails
          <Button variant="ghost" size="icon" className="size-7" onClick={() => router.refresh()} aria-label="Refresh">
            <RefreshCwIcon />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Queued</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => (
              <TableRow key={d.id} data-testid="delivery-row">
                <TableCell className="break-all">{d.to.join(", ")}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                </TableCell>
                <TableCell>{d.attempts}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmtDateTime(new Date(d.createdAt))}
                  {d.createdByName ? <span className="text-muted-foreground"> · {d.createdByName}</span> : null}
                </TableCell>
                <TableCell className="text-sm whitespace-normal">
                  {d.status === "sent" && d.sentAt ? `Sent ${fmtDateTime(new Date(d.sentAt))}` : null}
                  {d.status === "pending" && d.attempts > 0 ? `Retrying after ${fmtDateTime(new Date(d.nextAttemptAt))}. ` : null}
                  {d.status !== "sent" && d.lastError ? <span className="text-destructive">{d.lastError}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

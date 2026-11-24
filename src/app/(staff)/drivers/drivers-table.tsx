"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtPhone } from "@/lib/quotes/document";
import { saveDriverAction } from "./actions";

type Driver = { id: string; name: string; phone: string | null; active: boolean; notes: string | null; source: string };
type Form = { id: string | null; name: string; phone: string; active: boolean; notes: string };

const blank: Form = { id: null, name: "", phone: "", active: true, notes: "" };

export function DriversTable({ drivers }: { drivers: Driver[] }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    const r = await saveDriverAction(form);
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return void toast.error(r.error);
    }
    toast.success(form.id ? "Driver saved" : "Driver added");
    setForm(null);
    router.refresh();
  }

  const open = (f: Form) => {
    setErrors({});
    setForm(f);
  };

  return (
    <>
      <div>
        <Button onClick={() => open(blank)}>
          <PlusIcon />
          Add driver
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No drivers yet. Add one, or import the booking workbook.
                </TableCell>
              </TableRow>
            ) : (
              drivers.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.phone ? fmtPhone(d.phone) : "—"}</TableCell>
                  <TableCell>{d.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">{d.notes ?? ""}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${d.name}`}
                      onClick={() => open({ id: d.id, name: d.name, phone: d.phone ? fmtPhone(d.phone) : "", active: d.active, notes: d.notes ?? "" })}
                    >
                      <PencilIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit driver" : "Add driver"}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="drv-name">Name</Label>
                <Input id="drv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="drv-phone">Phone</Label>
                <Input id="drv-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {errors.phone ? <p className="text-xs text-destructive">{errors.phone}</p> : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="drv-notes">Notes</Label>
                <Textarea id="drv-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                Active (can be assigned)
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={save} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

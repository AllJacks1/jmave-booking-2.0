"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPhPhone } from "@/lib/phone";
import type { ClientHit } from "@/lib/quotes/schema";
import { createClientInlineAction, searchClientsAction } from "./actions";

export type PickedClient = {
  id: string;
  fullName: string;
  isBlacklisted: boolean;
  blacklistReason?: string | null;
  isRepeat: boolean;
  clientType: string;
};

/** Search existing clients or add one inline. */
export function ClientPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await searchClientsAction(term);
      setLoading(false);
      if (r.ok) setHits(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="client-picker">Client</Label>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="client-picker"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="min-w-0 flex-1 justify-between font-normal"
            >
              <span className="truncate">{value ? value.fullName : "Search clients…"}</span>
              <ChevronsUpDownIcon className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Name, FB name, phone or email" value={q} onValueChange={setQ} aria-label="Search clients" />
              <CommandList>
                <CommandEmpty>{q.trim().length < 2 ? "Type at least 2 characters." : loading ? "Searching…" : "No clients found."}</CommandEmpty>
                {q.trim().length >= 2 && hits.length ? (
                  <CommandGroup>
                    {hits.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => {
                          onChange({ id: c.id, fullName: c.fullName, isBlacklisted: c.isBlacklisted, isRepeat: c.isRepeat, clientType: c.clientType });
                          setOpen(false);
                        }}
                      >
                        <CheckIcon className={value?.id === c.id ? "opacity-100" : "opacity-0"} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{c.fullName}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[c.fbName, c.phone ? formatPhPhone(c.phone) : null].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                        {c.isBlacklisted ? <Badge variant="destructive">Blacklisted</Badge> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="secondary" onClick={() => setCreating(true)} disabled={disabled}>
          <PlusIcon />
          New client
        </Button>
        {value && !disabled ? (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </div>
      {value ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {value.isBlacklisted ? (
            <Badge variant="destructive" data-testid="client-blacklisted">
              <TriangleAlertIcon />
              Blacklisted
            </Badge>
          ) : null}
          <Badge variant="secondary">{value.isRepeat ? "Repeat client" : "New client"}</Badge>
          {value.clientType === "corporate" ? <Badge variant="outline">Corporate</Badge> : null}
        </div>
      ) : null}
      <NewClientDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(c) => {
          onChange(c);
          setCreating(false);
        }}
      />
    </div>
  );
}

function NewClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (c: PickedClient) => void;
}) {
  const [values, setValues] = useState({ fullName: "", fbName: "", phone: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const r = await createClientInlineAction({ ...values, clientType: "individual" });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setError(r.error);
      return;
    }
    toast.success("Client added");
    onCreated({ id: r.data.id, fullName: values.fullName.trim(), isBlacklisted: false, isRepeat: false, clientType: "individual" });
    setValues({ fullName: "", fbName: "", phone: "", email: "" });
    setErrors({});
  }

  const field = (k: keyof typeof values, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`new-client-${k}`}>{label}</Label>
      <Input id={`new-client-${k}`} value={values[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...extra} />
      {errors[k]?.[0] ? <p className="text-sm text-destructive">{errors[k]![0]}</p> : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>Add the rest of the details later on the client page.</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {field("fullName", "Full name", { autoComplete: "off", required: true })}
          {field("fbName", "FB name", { autoComplete: "off" })}
          {field("phone", "Phone", { inputMode: "tel", placeholder: "0917 123 4567" })}
          {field("email", "Email", { type: "email" })}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Add client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

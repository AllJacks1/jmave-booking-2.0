"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { applyFieldErrors, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { holidaySchema, type HolidayInput } from "@/lib/rates/schema";
import { formatManilaDate } from "@/lib/time";
import { addHolidayAction, removeHolidayAction } from "../actions";

type Holiday = { id: string; date: string; name: string };

export function HolidaysClient({
  year,
  years,
  holidays,
  canEdit,
}: {
  year: number;
  years: number[];
  holidays: Holiday[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const form = useForm<HolidayInput>({ resolver: zodResolver(holidaySchema), defaultValues: { date: "", name: "" } });

  async function onAdd(values: HolidayInput) {
    const r = await addHolidayAction(values);
    if (!r.ok) {
      applyFieldErrors(form.setError, r);
      if (!r.fieldErrors) toast.error(r.error);
      return;
    }
    toast.success("Holiday added");
    form.reset({ date: "", name: "" });
  }

  function remove(h: Holiday) {
    if (!confirm(`Remove ${h.name} (${formatManilaDate(h.date)})?`)) return;
    start(async () => {
      const r = await removeHolidayAction({ id: h.id });
      if (!r.ok) toast.error(r.error);
      else toast.success("Holiday removed");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {years.map((y) => (
          <Button key={y} asChild size="sm" variant={y === year ? "secondary" : "outline"}>
            <Link href={`/rates/holidays?year=${y}`}>{y}</Link>
          </Button>
        ))}
      </div>
      {canEdit ? (
        <Card>
          <CardContent>
            <form onSubmit={form.handleSubmit(onAdd)} noValidate className="grid items-end gap-4 sm:grid-cols-[12rem_1fr_auto]">
              <TextField control={form.control} name="date" label="Date" type="date" />
              <TextField control={form.control} name="name" label="Name" placeholder="e.g. Kadayawan Festival" />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <PlusIcon />
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Name</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  No holidays for {year}.
                </TableCell>
              </TableRow>
            ) : null}
            {holidays.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="whitespace-nowrap">{formatManilaDate(h.date)}</TableCell>
                <TableCell>{h.name}</TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${h.name}`} disabled={pending} onClick={() => remove(h)}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

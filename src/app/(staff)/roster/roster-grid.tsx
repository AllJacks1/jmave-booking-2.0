"use client";

import { CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DUTIES, DUTY_LABELS, type Duty } from "@/lib/bookings/constants";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { copyPreviousWeekAction, setShiftAction } from "./actions";

type Template = { id: string; name: string; startTime: string; endTime: string };
type Entry = { date: string; userId: string; templateId: string; duty: Duty };
type Person = { id: string; name: string; role: Role; active: boolean };

const selectClass = "h-9 w-full min-w-28 rounded-md border bg-background px-1.5 text-xs";

/** Cell value: "" (off) or `templateId|duty`. */
const cellValue = (e: Entry | undefined) => (e ? `${e.templateId}|${e.duty}` : "");

export function RosterGrid({
  week,
  days,
  dayLabels,
  templates,
  entries,
  people,
  editable,
  today,
}: {
  week: string;
  days: string[];
  dayLabels: string[];
  templates: Template[];
  entries: Entry[];
  people: Person[];
  editable: boolean;
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const byCell = new Map(entries.map((e) => [`${e.date}|${e.userId}`, e]));
  const names = new Map(templates.map((t) => [t.id, t.name]));

  async function change(date: string, person: Person, value: string) {
    const [templateId, duty] = value ? value.split("|") : [null, person.role === "operations" ? "operations" : "sales"];
    const key = `${date}|${person.id}`;
    setBusy(key);
    const r = await setShiftAction({ date, userId: person.id, templateId, duty: duty as Duty });
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    router.refresh();
  }

  async function copy() {
    setBusy("copy");
    const r = await copyPreviousWeekAction({ week });
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.data.added ? `Copied ${r.data.added} shift${r.data.added === 1 ? "" : "s"} from last week` : "Nothing to copy");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {editable ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={copy} disabled={busy !== null}>
            <CopyIcon />
            Copy previous week
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm" data-testid="roster-grid">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="sticky left-0 bg-muted py-2 pl-4">Staff</th>
              {days.map((d, i) => (
                <th key={d} className={cn("px-1 py-2", d === today && "text-foreground")}>
                  {dayLabels[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-muted-foreground">
                  No staff yet.
                </td>
              </tr>
            ) : null}
            {people.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="sticky left-0 bg-background py-2 pl-4">
                  <p className="font-medium whitespace-nowrap">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[p.role]}
                    {p.active ? "" : " · inactive"}
                  </p>
                </td>
                {days.map((d) => {
                  const e = byCell.get(`${d}|${p.id}`);
                  const key = `${d}|${p.id}`;
                  return (
                    <td key={d} className={cn("px-1 py-1.5", d === today && "bg-muted/40")} data-testid="roster-cell" data-date={d} data-user={p.name}>
                      {editable ? (
                        <select
                          aria-label={`${p.name} on ${d}`}
                          className={selectClass}
                          value={cellValue(e)}
                          disabled={busy !== null && busy !== key}
                          onChange={(ev) => change(d, p, ev.target.value)}
                        >
                          <option value="">Off</option>
                          {templates.map((t) =>
                            DUTIES.map((duty) => (
                              <option key={`${t.id}|${duty}`} value={`${t.id}|${duty}`}>
                                {t.name} · {DUTY_LABELS[duty]}
                              </option>
                            )),
                          )}
                        </select>
                      ) : e ? (
                        <span className="text-xs">
                          {names.get(e.templateId)} · {DUTY_LABELS[e.duty]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Off</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AUDIT_PAGE_SIZE, auditFilterOptions, auditListSchema, listAudit, requireAuditPage } from "@/lib/audit-log/service";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatManilaDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit log" };

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireAuditPage();
  const raw = await searchParams;
  const q = auditListSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined)));
  const [{ rows, total }, options] = await Promise.all([listAudit(me, q), auditFilterOptions(me)]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== "" && v !== "all" && k !== "page") p.set(k, String(v));
    }
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to prices, bookings, payments, users and settings, newest first. Open a row to see what changed."
      />
      <form className="flex flex-wrap items-end gap-3" method="get" role="search" aria-label="Filter the audit log">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="actor">Who</Label>
          <select id="actor" name="actor" defaultValue={q.actor} className={selectClass}>
            <option value="all">Anyone</option>
            <option value="system">System / public page</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
                {u.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entity">Record type</Label>
          <select id="entity" name="entity" defaultValue={q.entity ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-44 flex-col gap-1.5">
          <Label htmlFor="action">Action</Label>
          <Input id="action" name="action" list="audit-actions" defaultValue={q.action ?? ""} placeholder="e.g. booking. or payment.voided" />
          <datalist id="audit-actions">
            {options.actions.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="flex min-w-44 flex-col gap-1.5">
          <Label htmlFor="entityId">Record id</Label>
          <Input id="entityId" name="entityId" defaultValue={q.entityId ?? ""} placeholder="id or settings key" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={q.from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={q.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        <Button asChild variant="ghost">
          <Link href="/audit">Clear</Link>
        </Button>
      </form>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total.toLocaleString("en-PH")} entr{total === 1 ? "y" : "ies"}
      </p>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When (Manila)</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No audit entries match.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatManilaDateTime(r.at)}</TableCell>
                  <TableCell>
                    {r.actorId ? (
                      <>
                        {r.actorName ?? "Deleted user"}
                        {r.actorRole ? <span className="ml-1 text-xs text-muted-foreground">{ROLE_LABELS[r.actorRole]}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium">{r.entity}</span>
                    {r.entityId ? <span className="ml-1 break-all font-mono text-muted-foreground">{r.entityId}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/audit/${r.id}`} className="text-sm text-primary hover:underline">
                      View<span className="sr-only"> {r.action} at {formatManilaDateTime(r.at)}</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 ? (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            Page {q.page} of {pages}
          </span>
          {q.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(q.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          {q.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(q.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

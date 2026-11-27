import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diffJson, formatLeaf, type DiffKind } from "@/lib/audit-log/diff";
import { entityHref, getAuditEntry, requireAuditPage } from "@/lib/audit-log/service";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatManilaDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit entry" };

const KIND_LABEL: Record<DiffKind, string> = { added: "Added", removed: "Removed", changed: "Changed", same: "Same" };
const KIND_VARIANT: Record<DiffKind, "default" | "secondary" | "destructive" | "outline"> = {
  added: "default",
  removed: "destructive",
  changed: "secondary",
  same: "outline",
};

export default async function AuditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const me = await requireAuditPage();
  const { id } = await params;
  const showAll = (await searchParams).all === "1";
  const row = await getAuditEntry(me, id);
  if (!row) notFound();
  const rows = diffJson(row.before, row.after, { includeSame: showAll });
  const recordHref = entityHref(row.entity, row.entityId);
  const historyHref = row.entityId
    ? `/audit?${new URLSearchParams({ entity: row.entity, entityId: row.entityId })}`
    : null;

  return (
    <>
      <PageHeader
        title={row.action}
        description={`${formatManilaDateTime(row.at)} (Manila) · ${row.actorId ? `${row.actorName ?? "Deleted user"}${row.actorRole ? ` (${ROLE_LABELS[row.actorRole]})` : ""}` : "System"}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/audit">Back to audit log</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">Type:</span> {row.entity}
          </span>
          {row.entityId ? (
            <span className="break-all">
              <span className="text-muted-foreground">Id:</span> <span className="font-mono">{row.entityId}</span>
            </span>
          ) : null}
          {recordHref ? (
            <Link href={recordHref} className="text-primary hover:underline">
              Open record
            </Link>
          ) : null}
          {historyHref ? (
            <Link href={historyHref} className="text-primary hover:underline">
              All changes to this record
            </Link>
          ) : null}
        </CardContent>
      </Card>
      <Card className="py-0">
        <CardHeader className="flex flex-row items-center justify-between pt-6">
          <CardTitle>Before → after</CardTitle>
          <Link href={showAll ? `/audit/${row.id}` : `/audit/${row.id}?all=1`} className="text-sm text-primary hover:underline">
            {showAll ? "Show changes only" : "Show unchanged fields too"}
          </Link>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Before</TableHead>
              <TableHead>After</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No recorded field values.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.path}>
                  <TableCell className="font-mono text-xs">{d.path}</TableCell>
                  <TableCell>
                    <Badge variant={KIND_VARIANT[d.kind]}>{KIND_LABEL[d.kind]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-80 break-all font-mono text-xs">
                    {d.kind === "added" ? <span className="text-muted-foreground">—</span> : <del className="no-underline">{formatLeaf(d.before)}</del>}
                  </TableCell>
                  <TableCell className="max-w-80 break-all font-mono text-xs">
                    {d.kind === "removed" ? <span className="text-muted-foreground">—</span> : <ins className="no-underline">{formatLeaf(d.after)}</ins>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <details className="rounded-lg border p-4 text-sm">
        <summary className="cursor-pointer font-medium">Raw JSON</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Before</h2>
            <pre tabIndex={0} aria-label="Before (JSON)" className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(row.before, null, 2)}</pre>
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">After</h2>
            <pre tabIndex={0} aria-label="After (JSON)" className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(row.after, null, 2)}</pre>
          </div>
        </div>
      </details>
    </>
  );
}

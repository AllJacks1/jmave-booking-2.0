import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { listImportRuns, MAX_IMPORT_BYTES } from "@/lib/import/service";
import { can } from "@/lib/permissions";
import { formatManilaDateTime } from "@/lib/time";
import { RunStatusBadge } from "./run-status-badge";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import" };

const KIND_LABELS: Record<string, string> = {
  booking_workbook: "Booking workbook",
  dms_workbook: "DMS workbook",
  unknown: "Unknown",
};

export default async function ImportPage() {
  const { user, allowed } = await requirePage("import.view");
  if (!allowed) return <NoAccess />;
  const runs = await listImportRuns();
  const canRun = can(user, "import.run");

  return (
    <>
      <PageHeader
        title="Import"
        description={canRun ? "Load the old workbooks. Each upload is previewed first; nothing changes until you commit." : "Read-only. Only a Super Admin can import."}
      />
      {canRun ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload a workbook</CardTitle>
            <CardDescription>
              “Self-Driven and With Driver.xlsx” (fleet, rate cards, clients, QTN numbers) or “2026 Daily Movement Sheet.xlsx” (blacklist). .xlsx only, up to{" "}
              {MAX_IMPORT_BYTES / 1024 / 1024} MB. Re-importing the same file changes nothing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm maxBytes={MAX_IMPORT_BYTES} />
          </CardContent>
        </Card>
      ) : null}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Uploaded</TableHead>
              <TableHead>File</TableHead>
              <TableHead className="hidden md:table-cell">Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right sm:table-cell">New</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Changed</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No imports yet.
                </TableCell>
              </TableRow>
            ) : null}
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/import/${r.id}`} className="underline-offset-4 hover:underline">
                    {formatManilaDateTime(r.createdAt)}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate">{r.fileName}</TableCell>
                <TableCell className="hidden md:table-cell">{KIND_LABELS[r.kind] ?? r.kind}</TableCell>
                <TableCell>
                  <RunStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.totals?.new ?? "—"}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.totals?.changed ?? "—"}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.totals?.warnings ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

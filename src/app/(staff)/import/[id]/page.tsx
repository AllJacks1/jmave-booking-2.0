import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requirePage } from "@/lib/auth/page";
import { getImportRun } from "@/lib/import/service";
import type { ImportSummary } from "@/lib/import/types";
import { can } from "@/lib/permissions";
import { formatManilaDateTime } from "@/lib/time";
import { RunStatusBadge } from "../run-status-badge";
import { CommitButton } from "./commit-button";
import { SectionView } from "./section-view";

export const metadata: Metadata = { title: "Import preview" };

export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("import.view");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const run = await getImportRun(id);
  if (!run) notFound();
  const summary = "sections" in run.summary ? (run.summary as ImportSummary) : null;

  return (
    <>
      <PageHeader
        title={run.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <span>Uploaded {formatManilaDateTime(run.createdAt)}</span>
            {run.committedAt ? <span>· committed {formatManilaDateTime(run.committedAt)}</span> : null}
            <span className="font-mono text-xs">sha256 {run.fileSha256.slice(0, 12)}…</span>
          </span>
        }
        actions={
          run.status === "previewed" && can(user, "import.run") && summary ? <CommitButton runId={run.id} totals={summary.totals} /> : null
        }
      />
      {run.error ? (
        <Alert variant="destructive">
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      ) : null}
      {summary ? (
        <>
          <p className="text-sm text-muted-foreground">
            {run.status === "previewed" ? "If you commit now: " : "Result: "}
            {summary.totals.new} new, {summary.totals.changed} changed, {summary.totals.unchanged} unchanged, {summary.totals.skipped} skipped,{" "}
            {summary.totals.warnings} warning(s) to review.
          </p>
          {summary.sections.map((s) => (
            <SectionView key={s.section} section={s} />
          ))}
        </>
      ) : null}
    </>
  );
}

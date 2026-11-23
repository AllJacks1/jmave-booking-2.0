"use client";

import { DatabaseZapIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { commitImportAction } from "../actions";

export function CommitButton({ runId, totals }: { runId: string; totals: { new: number; changed: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function commit() {
    if (!confirm(`Commit this import? ${totals.new} new and ${totals.changed} changed record(s) will be written in one transaction.`)) return;
    start(async () => {
      const r = await commitImportAction({ runId });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Imported: ${r.data.totals.new} new, ${r.data.totals.changed} changed`);
      router.refresh();
    });
  }

  return (
    <Button onClick={commit} disabled={pending}>
      <DatabaseZapIcon />
      {pending ? "Committing…" : "Commit import"}
    </Button>
  );
}

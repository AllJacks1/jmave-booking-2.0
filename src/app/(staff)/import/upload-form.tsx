"use client";

import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadForm({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose a file.");
    if (!/\.xlsx$/i.test(file.name)) return setError("Only .xlsx files can be imported.");
    if (file.size > maxBytes) return setError(`The file is larger than ${maxBytes / 1024 / 1024} MB.`);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? `Upload failed (${res.status}).`);
        if (json.runId) router.refresh();
        return;
      }
      router.push(`/import/${json.runId}`);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="file"
          name="file"
          aria-label="Workbook file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="max-w-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={busy || !file}>
          <UploadIcon />
          {busy ? "Reading workbook…" : "Upload and preview"}
        </Button>
      </div>
      {busy ? <p className="text-sm text-muted-foreground">The booking workbook takes up to a minute to read.</p> : null}
    </form>
  );
}

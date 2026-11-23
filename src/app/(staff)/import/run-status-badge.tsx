import { Badge } from "@/components/ui/badge";

export function RunStatusBadge({ status }: { status: "previewed" | "committed" | "failed" }) {
  if (status === "committed") return <Badge>Committed</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Preview</Badge>;
}

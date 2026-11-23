import { Badge } from "@/components/ui/badge";

export function RateCardStatusBadge({ status }: { status: "draft" | "active" | "archived" }) {
  if (status === "active") return <Badge>Active</Badge>;
  if (status === "draft") return <Badge variant="secondary">Draft</Badge>;
  return <Badge variant="outline">Archived</Badge>;
}

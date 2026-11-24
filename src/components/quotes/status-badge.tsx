import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type EffectiveStatus } from "@/lib/quotes/document";

const VARIANT: Record<EffectiveStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  issued: "default",
  accepted: "secondary",
  expired: "outline",
  lost: "destructive",
  cancelled: "outline",
};

export function QuoteStatusBadge({ status, kind }: { status: EffectiveStatus; kind?: "quick" | "formal" }) {
  if (kind === "quick") return <Badge variant="secondary">{status === "expired" ? "Estimate · expired" : "Estimate"}</Badge>;
  return (
    <Badge variant={VARIANT[status]} data-testid="quote-status">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

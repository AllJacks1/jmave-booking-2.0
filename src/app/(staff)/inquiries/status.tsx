import { Badge } from "@/components/ui/badge";
import type { InquiryStatus } from "@/db/schema";

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  quoted: "Quoted",
  converted: "Converted",
  rejected: "Rejected",
};

export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  const variant = status === "new" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return <Badge variant={variant}>{INQUIRY_STATUS_LABELS[status]}</Badge>;
}

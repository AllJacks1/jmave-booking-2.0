import { BanIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function BlacklistBadge() {
  return (
    <Badge variant="destructive" data-testid="blacklist-badge">
      <BanIcon />
      Blacklisted
    </Badge>
  );
}

export function RepeatBadge({ repeat }: { repeat: boolean }) {
  return repeat ? <Badge variant="secondary">Repeat client</Badge> : <Badge variant="outline">New client</Badge>;
}

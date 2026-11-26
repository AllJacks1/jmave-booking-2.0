import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { pointsValueCentavos } from "@/lib/pricing/rewards";
import { fmtPeso } from "@/lib/quotes/document";
import { formatManilaDate } from "@/lib/time";

/** Card facts as on the old `Interface` tab: number, member since, expiry, tier, points, peso value. */
export function LoyaltySummary({
  cardNo,
  memberSince,
  expiresAt,
  expired,
  tier,
  balance,
  href,
}: {
  cardNo: string;
  memberSince: string;
  expiresAt: string;
  expired: boolean;
  tier: number | null;
  balance: number;
  href?: string;
}) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm" data-testid="loyalty-summary">
      <dt className="text-muted-foreground">Card number</dt>
      <dd className="font-medium">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {cardNo}
          </Link>
        ) : (
          cardNo
        )}
      </dd>
      <dt className="text-muted-foreground">Member since</dt>
      <dd>{formatManilaDate(memberSince)}</dd>
      <dt className="text-muted-foreground">Expires</dt>
      <dd className="flex items-center gap-2">
        {formatManilaDate(expiresAt)}
        {expired ? <Badge variant="destructive">Expired</Badge> : <Badge variant="secondary">Active</Badge>}
      </dd>
      <dt className="text-muted-foreground">Tier</dt>
      <dd>{tier === null ? "—" : `Tier ${tier}`}</dd>
      <dt className="text-muted-foreground">Points</dt>
      <dd className="font-medium tabular-nums" data-testid="loyalty-points">
        {balance.toLocaleString("en-PH")}
      </dd>
      <dt className="text-muted-foreground">Peso value</dt>
      <dd className="tabular-nums" data-testid="loyalty-value">
        {fmtPeso(pointsValueCentavos(balance))}
      </dd>
    </dl>
  );
}

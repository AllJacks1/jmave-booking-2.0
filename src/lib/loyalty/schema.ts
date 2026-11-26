import { z } from "zod";

export const adjustSchema = z.object({
  accountId: z.uuid(),
  points: z
    .number({ error: "Enter the points" })
    .int("Whole points")
    .min(-10_000_000, "Too many")
    .max(10_000_000, "Too many")
    .refine((n) => n !== 0, "Cannot be 0"),
  reason: z.string().trim().min(1, "Give a reason").max(1000, "At most 1,000 characters"),
});
export type AdjustInput = z.input<typeof adjustSchema>;

export const tierSchema = z.object({
  accountId: z.uuid(),
  tier: z.number().int("Whole number").min(0, "0 to 99").max(99, "0 to 99").nullable(),
});
export type TierInput = z.input<typeof tierSchema>;

export const linkClientSchema = z.object({ accountId: z.uuid(), clientId: z.uuid() });
export type LinkClientInput = z.input<typeof linkClientSchema>;

export const rewardsListSchema = z.object({
  q: z.string().trim().max(100).default(""),
  filter: z.enum(["all", "unlinked", "expired"]).catch("all").default("all"),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type RewardsListQuery = z.output<typeof rewardsListSchema>;

export const POINTS_KIND_LABELS = {
  earn: "Earned",
  reversal: "Return undone",
  redeem: "Redeemed",
  refund: "Refund (cancelled)",
  adjust: "Adjustment",
  import: "Imported",
} as const;

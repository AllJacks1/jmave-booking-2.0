import { z } from "zod";
import { rateCardDataSchema } from "@/lib/pricing/rate-card";
import { isDateKey } from "@/lib/time";

export const createDraftSchema = z.object({
  fromId: z.uuid(),
  name: z.string().trim().min(1, "Required").max(120),
});

export const updateDraftSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Required").max(120),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  data: rateCardDataSchema,
});
export type UpdateDraftInput = z.input<typeof updateDraftSchema>;

export const rateCardIdSchema = z.object({ id: z.uuid() });

export const holidaySchema = z.object({
  date: z.string().refine(isDateKey, "Enter a valid date"),
  name: z.string().trim().min(1, "Required").max(120),
});
export type HolidayInput = z.input<typeof holidaySchema>;
export const holidayIdSchema = z.object({ id: z.uuid() });

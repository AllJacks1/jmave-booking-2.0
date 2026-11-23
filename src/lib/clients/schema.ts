import { z } from "zod";
import { normalisePhPhone } from "@/lib/phone";
import { isDateKey } from "@/lib/time";

const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

const optPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const e164 = normalisePhPhone(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid PH number, e.g. 0917 123 4567" });
      return z.NEVER;
    }
    return e164;
  })
  .nullable()
  .default(null);

export const CLIENT_TYPES = ["individual", "corporate"] as const;
export const CLIENT_TYPE_LABELS: Record<(typeof CLIENT_TYPES)[number], string> = {
  individual: "Individual",
  corporate: "Corporate",
};

export const clientSchema = z.object({
  fullName: z.string().trim().min(1, "Required").max(160),
  fbName: optText(160),
  phone: optPhone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .transform((v, ctx) => {
      if (v === "") return null;
      if (!z.email().safeParse(v).success) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email" });
        return z.NEVER;
      }
      return v;
    })
    .nullable()
    .default(null),
  birthday: z
    .string()
    .trim()
    .refine((v) => v === "" || isDateKey(v), "Enter a valid date")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  address: optText(500),
  altContactName: optText(160),
  altContactPhone: optPhone,
  driversLicenseNo: optText(40),
  companyName: optText(160),
  clientType: z.enum(CLIENT_TYPES).default("individual"),
  notes: optText(4000),
});
export type ClientInput = z.input<typeof clientSchema>;

export const updateClientSchema = z.object({ id: z.uuid(), client: clientSchema });

export const blacklistSchema = z
  .object({
    id: z.uuid(),
    blacklisted: z.boolean(),
    reason: z
      .string()
      .trim()
      .max(1000)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
  })
  .refine((v) => !v.blacklisted || !!v.reason, { path: ["reason"], message: "Give a reason" });
export type BlacklistInput = z.input<typeof blacklistSchema>;

export const clientSearchSchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  blacklisted: z.enum(["all", "only"]).default("all"),
});

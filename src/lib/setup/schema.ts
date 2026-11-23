import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";

export const setupSchema = z
  .object({
    setupToken: z.string().min(1, "Required").max(500),
    name: z.string().trim().min(1, "Required").max(120),
    email: z.email("Enter a valid email").trim().toLowerCase().max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type SetupInput = z.input<typeof setupSchema>;

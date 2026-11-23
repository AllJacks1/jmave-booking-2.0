import { z } from "zod";
import { ROLES } from "@/db/schema";
import { passwordSchema } from "@/lib/auth/password";

const name = z.string().trim().min(1, "Required").max(120);
const role = z.enum(ROLES, { error: "Pick a role" });
const id = z.uuid();

export const createUserSchema = z.object({
  name,
  displayName: name,
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  role,
});

export const updateUserSchema = z.object({
  id,
  name,
  displayName: name,
  role,
});

export const userIdSchema = z.object({ id });

export const setActiveSchema = z.object({ id, active: z.boolean() });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a different password",
  });

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

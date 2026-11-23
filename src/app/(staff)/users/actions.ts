"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  updateUser,
} from "@/lib/users/service";
import type { CreateUserInput, UpdateUserInput } from "@/lib/users/schema";

// Every action re-reads the session and goes through the permission table in
// the service (`defineAction`). Forbidden calls return { ok: false, status: 403 }.

export async function createUserAction(input: CreateUserInput) {
  const result = await createUser(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/users");
  return result;
}

export async function updateUserAction(input: UpdateUserInput) {
  const result = await updateUser(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/users");
  return result;
}

export async function setUserActiveAction(input: { id: string; active: boolean }) {
  const result = await setUserActive(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/users");
  return result;
}

export async function resetUserPasswordAction(input: { id: string }) {
  const result = await resetUserPassword(await getCurrentUser(), input);
  if (result.ok) revalidatePath("/users");
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import type { ClientInput } from "@/lib/clients/schema";
import { createClient } from "@/lib/clients/service";
import { sendQuotationEmail, type SendEmailInput } from "@/lib/quotes/email";
import type { QuoteFormInput } from "@/lib/quotes/schema";
import {
  issueQuotation,
  markAccepted,
  markLost,
  previewPrice,
  reviseQuotation,
  saveDraft,
  saveQuick,
  searchClientsForQuote,
  updateNotes,
} from "@/lib/quotes/service";

export async function previewPriceAction(form: QuoteFormInput) {
  return previewPrice(await getCurrentUser(), form);
}

export async function saveQuickAction(input: { id: string | null; form: QuoteFormInput }) {
  const r = await saveQuick(await getCurrentUser(), input);
  if (r.ok) revalidatePath("/quotes", "layout");
  return r;
}

export async function saveDraftAction(input: { id: string | null; form: QuoteFormInput }) {
  return saveDraft(await getCurrentUser(), input);
}

export async function issueQuotationAction(input: { id: string; form: QuoteFormInput; overrideReason?: string }) {
  const r = await issueQuotation(await getCurrentUser(), input);
  if (r.ok) revalidatePath("/quotes", "layout");
  return r;
}

export async function reviseQuotationAction(input: { id: string }) {
  return reviseQuotation(await getCurrentUser(), input);
}

export async function markLostAction(input: { id: string; reason: string }) {
  const r = await markLost(await getCurrentUser(), input);
  if (r.ok) revalidatePath("/quotes", "layout");
  return r;
}

export async function markAcceptedAction(input: { id: string }) {
  const r = await markAccepted(await getCurrentUser(), input);
  if (r.ok) revalidatePath("/quotes", "layout");
  return r;
}

export async function updateNotesAction(input: { id: string; notes: string }) {
  return updateNotes(await getCurrentUser(), input);
}

export async function searchClientsAction(q: string) {
  return searchClientsForQuote(await getCurrentUser(), { q });
}

export async function createClientInlineAction(input: ClientInput) {
  return createClient(await getCurrentUser(), input);
}

export async function sendQuotationEmailAction(input: SendEmailInput) {
  const r = await sendQuotationEmail(await getCurrentUser(), input);
  if (r.ok) revalidatePath(`/quotes/${input.id}`);
  return r;
}

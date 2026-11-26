"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { endBlock, saveBlock } from "@/lib/bookings/blocks";
import type { BlockInput, BookingDetailsInput, BookingScheduleInput, PaymentInput } from "@/lib/bookings/schema";
import type { ChargeKind } from "@/lib/bookings/constants";
import { extendBooking, previewExtension, undoReturn } from "@/lib/check-in/service";
import type { ExtensionInput, UndoReturnInput } from "@/lib/check-in/schema";
import {
  addCharge,
  addPayment,
  applyDeposit,
  assignDriver,
  availabilityAction,
  cancelBooking,
  closeBooking,
  confirmBooking,
  convertToBooking,
  markNoShow,
  removeCharge,
  updateBookingDetails,
  updateBookingSchedule,
  voidPayment,
} from "@/lib/bookings/service";

type Result = { ok: boolean };

function refresh<T extends Result>(r: T, ...paths: string[]): T {
  if (r.ok) {
    revalidatePath("/bookings", "layout");
    revalidatePath("/calendar");
    revalidatePath("/board");
    for (const p of paths) revalidatePath(p);
  }
  return r;
}

export async function convertToBookingAction(input: { quotationId: string }) {
  return refresh(await convertToBooking(await getCurrentUser(), input), "/quotes", "/clients", "/dashboard");
}

export async function updateDetailsAction(input: BookingDetailsInput) {
  return refresh(await updateBookingDetails(await getCurrentUser(), input));
}

export async function updateScheduleAction(input: BookingScheduleInput) {
  return refresh(await updateBookingSchedule(await getCurrentUser(), input), "/clients");
}

export async function confirmBookingAction(input: { id: string; withoutRf?: boolean; withoutRfReason?: string }) {
  return refresh(await confirmBooking(await getCurrentUser(), input), "/clients");
}

export async function cancelBookingAction(input: { id: string; reason: string }) {
  return refresh(await cancelBooking(await getCurrentUser(), input), "/clients");
}

export async function noShowAction(input: { id: string; reason?: string }) {
  return refresh(await markNoShow(await getCurrentUser(), input), "/clients");
}

export async function closeBookingAction(input: { id: string }) {
  return refresh(await closeBooking(await getCurrentUser(), input));
}

export async function addPaymentAction(input: PaymentInput) {
  return refresh(await addPayment(await getCurrentUser(), input));
}

export async function voidPaymentAction(input: { id: string; reason: string }) {
  return refresh(await voidPayment(await getCurrentUser(), input));
}

export async function applyDepositAction(input: { bookingId: string; amountCentavos: number }) {
  return refresh(await applyDeposit(await getCurrentUser(), input));
}

export async function addChargeAction(input: { bookingId: string; kind: ChargeKind; label: string; amountCentavos: number }) {
  return refresh(await addCharge(await getCurrentUser(), input));
}

export async function removeChargeAction(input: { id: string; reason: string }) {
  return refresh(await removeCharge(await getCurrentUser(), input));
}

export async function assignDriverAction(input: { id: string; driverId: string | null; overrideReason?: string }) {
  return refresh(await assignDriver(await getCurrentUser(), input), "/drivers");
}

export async function availabilityCheckAction(input: { vehicleId: string; startAt: string; endAt: string; excludeBookingId?: string | null }) {
  return availabilityAction(await getCurrentUser(), input);
}

export async function saveBlockAction(input: BlockInput) {
  return refresh(await saveBlock(await getCurrentUser(), input));
}

export async function endBlockAction(input: { id: string }) {
  return refresh(await endBlock(await getCurrentUser(), input));
}

export async function previewExtensionAction(input: ExtensionInput) {
  return previewExtension(await getCurrentUser(), input);
}

export async function extendBookingAction(input: ExtensionInput) {
  return refresh(await extendBooking(await getCurrentUser(), input));
}

export async function undoReturnAction(input: UndoReturnInput) {
  return refresh(await undoReturn(await getCurrentUser(), input));
}

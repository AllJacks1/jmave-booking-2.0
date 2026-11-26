/**
 * Release / return check-in and extension inputs (bookings-and-movement.md §5).
 * Shared by the phone forms and the server actions.
 */
import { z } from "zod";
import { dateKeySchema, timeSchema } from "@/lib/bookings/schema";
import { FUEL_EIGHTHS_MAX } from "@/lib/bookings/constants";

const odometer = z
  .number({ error: "Enter the odometer reading" })
  .int("Whole kilometres")
  .min(0, "Cannot be negative")
  .max(2_000_000, "Too high");
const fuel = z
  .number({ error: "Choose the fuel level" })
  .int()
  .min(0, "0 to 8 eighths")
  .max(FUEL_EIGHTHS_MAX, "0 to 8 eighths");
const notes = z
  .string()
  .trim()
  .max(1000, "At most 1,000 characters")
  .default("")
  .transform((v) => (v === "" ? null : v));

const checkInFields = {
  bookingId: z.uuid(),
  actualDate: dateKeySchema,
  actualTime: timeSchema,
  odometerKm: odometer,
  fuelLevelEighths: fuel,
  /** Release: delivery done (FD). Return: pick-up done (PU). */
  delivery: z.boolean().default(false),
  notes,
};

export const releaseSchema = z.object(checkInFields);
export type ReleaseInput = z.input<typeof releaseSchema>;

export const returnSchema = z.object(checkInFields);
export type ReturnInput = z.input<typeof returnSchema>;

export const extensionSchema = z.object({
  bookingId: z.uuid(),
  newEndDate: dateKeySchema,
  newEndTime: timeSchema,
  note: notes,
});
export type ExtensionInput = z.input<typeof extensionSchema>;

export const undoReturnSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason").max(1000, "At most 1,000 characters"),
});
export type UndoReturnInput = z.input<typeof undoReturnSchema>;

/** Check-ins may not be dated in the future beyond this (clock drift, typing). */
export const FUTURE_TOLERANCE_MINUTES = 15;

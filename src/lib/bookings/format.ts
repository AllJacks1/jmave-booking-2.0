/**
 * Booking display helpers. Pure: safe in client components.
 */
import type { HoldConflict } from "@/lib/holds";
import type { Service } from "@/lib/pricing/types";
import { BLOCK_KIND_LABELS, type BlockKind, type BookingStatus } from "./constants";

export type Availability =
  | { state: "available" }
  | { state: "pending_overlap"; pending: { id: string; number: string }[] }
  | { state: "booked"; conflict: HoldConflict; pending: { id: string; number: string }[] };

export function availabilityMessage(a: Availability): string {
  if (a.state === "available") return "Available";
  if (a.state === "pending_overlap") {
    return `Overlaps pending reservation ${a.pending.map((p) => p.number).join(", ")}`;
  }
  const c = a.conflict;
  return c.kind === "booking"
    ? `Booked by ${c.bookingNumber ?? "another booking"}`
    : `Blocked: ${BLOCK_KIND_LABELS[(c.blockKind ?? "other") as BlockKind].toLowerCase()}`;
}

/**
 * Movement codes (bookings-and-movement.md §6): FD for delivery, PU for
 * pick-up, WD with driver, PR pending reservation.
 */
export function movementCodes(b: {
  status: BookingStatus;
  service: Service;
  deliveryAddress: string | null;
  pickupAddress: string | null;
}): string[] {
  const codes: string[] = [];
  if (b.status === "pending_reservation") codes.push("PR");
  if (b.service === "with_driver") codes.push("WD");
  if (b.deliveryAddress) codes.push("FD");
  if (b.pickupAddress) codes.push("PU");
  return codes;
}

/** Calendar/board label: `FD WIGO GRAY - Client` (§1), vehicle name optional. */
export function bookingLabel(codes: string[], clientName: string | null, vehicleShort?: string | null): string {
  const head = [...codes, vehicleShort?.toUpperCase()].filter(Boolean).join(" ");
  const client = clientName?.trim() || "No client";
  return head ? `${head} - ${client}` : client;
}

/** `Wigo Gray AT - ABC 1234` → `WIGO GRAY`: first two words of the display name. */
export function vehicleShortName(displayName: string): string {
  return displayName.split(/\s+/).slice(0, 2).join(" ");
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { BookingStatusBadge } from "@/components/bookings/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermissionPage } from "@/lib/bookings/page";
import { bookingLabel, movementCodes } from "@/lib/bookings/format";
import { checkInView } from "@/lib/check-in/service";
import { can } from "@/lib/permissions";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtDateTime } from "@/lib/quotes/document";
import { manilaDateKey, manilaTime } from "@/lib/time";
import { CheckInForm } from "./check-in-form";

/** Release / return check-in page (Ops+, phone first). */
export async function CheckInPage({ mode, id }: { mode: "release" | "return"; id: string }) {
  const user = await requirePermissionPage("movement.check_in");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await checkInView(id);
  if (!v) notFound();
  const b = v.booking;
  const now = new Date();
  const planned = mode === "release" ? b.startAt : b.endAt;
  const backHref = `/board?date=${manilaDateKey(planned)}`;
  const expected = mode === "release" ? "confirmed" : "released";
  const clientName = b.clientName;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <Link href={backHref} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Board
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "release" ? "Release" : "Return"} · {b.number}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <BookingStatusBadge status={b.status} />
          <span>{SERVICE_LABELS[b.service]}</span>
        </div>
      </div>
      <Card>
        <CardContent className="grid gap-2 text-sm">
          <p className="font-medium">{bookingLabel(movementCodes(b), clientName)}</p>
          <p>
            {v.vehicleName ?? "No vehicle"}
            {v.plate ? ` · ${v.plate}` : ""}
          </p>
          <p className="text-muted-foreground">
            {mode === "release" ? "Release planned" : "Return due"}: {fmtDateTime(planned)}
          </p>
          {b.destination ? <p className="text-muted-foreground">Destination: {b.destination}</p> : null}
          {can(user, "bookings.manage") ? (
            <Link href={`/bookings/${b.id}`} className="text-sm underline-offset-4 hover:underline">
              Open booking
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {b.status !== expected ? (
        <Alert>
          <AlertTitle>{mode === "release" ? "Not ready for release" : "Not out"}</AlertTitle>
          <AlertDescription>
            {mode === "release"
              ? b.status === "pending_reservation"
                ? "This booking is still a pending reservation. Sales must confirm it first."
                : `This booking is ${b.status.replace("_", " ")}.`
              : b.status === "returned" || b.status === "closed"
                ? `Returned ${v.return ? fmtDateTime(v.return.actualAt) : ""}.`
                : "Release the car before recording its return."}
          </AlertDescription>
        </Alert>
      ) : (
        <CheckInForm
          mode={mode}
          bookingId={b.id}
          backHref={backHref}
          defaults={{ date: manilaDateKey(now), time: manilaTime(now) }}
          address={mode === "release" ? b.deliveryAddress : b.pickupAddress}
          reference={
            mode === "return"
              ? v.release
                ? { label: `Released ${fmtDateTime(v.release.actualAt)}`, odometerKm: v.release.odometerKm, fuelLevelEighths: v.release.fuelLevelEighths }
                : null
              : v.lastOdometerKm !== null
                ? { label: "Last odometer on record", odometerKm: v.lastOdometerKm, fuelLevelEighths: null }
                : null
          }
        />
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusBadge } from "@/components/bookings/status";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { allowedEvents, detailsEditable, paymentsOpen, scheduleEditable } from "@/lib/booking-status";
import { availabilityMessage, bookingLabel, movementCodes } from "@/lib/bookings/format";
import { requirePermissionPage } from "@/lib/bookings/page";
import { getBookingView, staffOptions } from "@/lib/bookings/queries";
import { listDrivers } from "@/lib/drivers/service";
import { can } from "@/lib/permissions";
import { SERVICE_LABELS } from "@/lib/pricing/types";
import { fmtDateTime, fmtPhone } from "@/lib/quotes/document";
import { listVehiclesForQuotes } from "@/lib/quotes/service";
import { manilaDateKey, manilaTime } from "@/lib/time";
import { BookingActions } from "./booking-actions";
import { ChargesCard, PaymentsCard } from "./ledger-cards";
import { DetailsForm, DriverAssign, ScheduleForm } from "./booking-forms";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await getBookingView(id);
  if (!v) notFound();
  const b = v.booking;
  const [vehicles, staff, driverList] = await Promise.all([
    listVehiclesForQuotes(),
    staffOptions(),
    b.service === "with_driver" ? listDrivers({ activeOnly: true }) : Promise.resolve([]),
  ]);
  const clientName = v.client?.fullName ?? b.clientName;
  const codes = movementCodes(b);

  return (
    <>
      <PageHeader
        title={b.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            <span>{bookingLabel(codes, clientName)}</span>
            <span>· {SERVICE_LABELS[b.service]}</span>
            {b.imported ? <span>· imported</span> : null}
          </span>
        }
      />
      <BookingActions
        id={b.id}
        events={allowedEvents(b.status)}
        hasReservationFee={v.ledger.reservationFeePaid > 0}
        canConfirmWithoutRf={can(user, "bookings.confirm_without_rf")}
        availability={v.availability}
      />
      {b.status === "cancelled" || b.status === "no_show" ? (
        <Alert>
          <AlertTitle>{b.status === "cancelled" ? "Cancelled" : "No-show"}</AlertTitle>
          <AlertDescription>{b.statusNote ?? "—"}</AlertDescription>
        </Alert>
      ) : null}
      {v.availability && v.availability.state !== "available" ? (
        <Alert variant={v.availability.state === "booked" && b.status === "pending_reservation" ? "destructive" : "default"} data-testid="availability">
          <AlertTitle>{availabilityMessage(v.availability)}</AlertTitle>
          <AlertDescription>
            {v.availability.state === "booked"
              ? "Confirming will be refused until the other booking or block moves."
              : "Pending reservations do not hold the car. Whoever confirms first gets it."}
          </AlertDescription>
        </Alert>
      ) : null}
      {b.status === "pending_reservation" && b.statusNote ? (
        <Alert>
          <AlertTitle>Note</AlertTitle>
          <AlertDescription>{b.statusNote}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ScheduleForm
            id={b.id}
            editable={scheduleEditable(b.status)}
            vehicles={vehicles.map((x) => ({ id: x.id, label: x.displayName }))}
            initial={{
              vehicleId: b.vehicleId ?? "",
              startDate: manilaDateKey(b.startAt),
              startTime: manilaTime(b.startAt),
              endDate: manilaDateKey(b.endAt),
              endTime: manilaTime(b.endAt),
            }}
            vehicleLabel={v.vehicle?.displayName ?? b.vehicleLabel}
            holdText={v.hold ? `${v.hold.active ? "Holding" : "Released"}: ${fmtDateTime(v.hold.start)} → ${fmtDateTime(v.hold.end)} (incl. turnaround)` : null}
          />
          <ChargesCard bookingId={b.id} charges={v.charges} ledger={v.ledger} open={paymentsOpen(b.status)} />
          <PaymentsCard
            bookingId={b.id}
            payments={v.payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString(), voidedAt: p.voidedAt?.toISOString() ?? null }))}
            ledger={v.ledger}
            open={paymentsOpen(b.status)}
            canVoid={can(user, "payments.void") && b.status !== "closed"}
            staff={staff}
            meId={user.id}
          />
          <DetailsForm
            editable={detailsEditable(b.status)}
            service={b.service}
            initial={{
              id: b.id,
              destination: b.destination ?? "",
              deliveryAddress: b.deliveryAddress ?? "",
              pickupAddress: b.pickupAddress ?? "",
              driverNameOnLicense: b.driverNameOnLicense ?? "",
              driversLicenseNo: b.driversLicenseNo ?? "",
              idsPresented: b.idsPresented as never,
              passengers: b.passengers,
              luggage: b.luggage ?? "",
              itinerary: b.itinerary ?? "",
              sourceChannel: b.sourceChannel,
              contactHandle: b.contactHandle ?? "",
              reworkLink: b.reworkLink ?? "",
              orIssued: b.orIssued,
              notes: b.notes ?? "",
            }}
          />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {v.client ? (
                <>
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/clients/${v.client.id}`}>
                    {v.client.fullName}
                  </Link>
                  {v.client.isBlacklisted ? <p className="text-destructive">Blacklisted: {v.client.blacklistReason ?? "—"}</p> : null}
                  <Info label="Contact" value={v.client.phone ? fmtPhone(v.client.phone) : "—"} />
                  <Info label="Email" value={v.client.email ?? "—"} />
                  <Info label="Address" value={v.client.address ?? "—"} />
                  <Info label="Birthday" value={v.client.birthday ?? "—"} />
                  <Info
                    label="Alternative contact"
                    value={v.client.altContactName || v.client.altContactPhone ? `${v.client.altContactName ?? ""} ${v.client.altContactPhone ? fmtPhone(v.client.altContactPhone) : ""}`.trim() : "—"}
                  />
                </>
              ) : (
                <p>{b.clientName ?? "No client"}</p>
              )}
            </CardContent>
          </Card>
          {b.service === "with_driver" ? (
            <DriverAssign
              id={b.id}
              current={v.driver}
              drivers={driverList.map((d) => ({ id: d.id, name: d.name }))}
              clash={v.driverClash.map((c) => c.number)}
              overrideReason={b.driverOverlapReason}
              canOverride={can(user, "drivers.override_overlap")}
              editable={detailsEditable(b.status) && b.status !== "closed"}
            />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Info
                label="Quotation"
                value={
                  v.quotation ? (
                    <Link className="underline-offset-4 hover:underline" href={`/quotes/${v.quotation.id}`}>
                      {v.quotation.number}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <Info label="Created" value={`${fmtDateTime(b.createdAt)} · ${v.createdByName ?? "—"}`} />
              <Info label="Confirmed" value={b.confirmedAt ? `${fmtDateTime(b.confirmedAt)} · ${v.confirmedByName ?? "—"}` : "—"} />
              {b.confirmWithoutRfReason ? <Info label="Confirmed without RF" value={b.confirmWithoutRfReason} /> : null}
              <div>
                <p className="text-xs text-muted-foreground uppercase">History</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {v.audit.map((a) => (
                    <li key={a.id} className="text-xs">
                      <span className="text-muted-foreground">{fmtDateTime(a.at)}</span> · {a.action.replace("booking.", "").replace(/_/g, " ")} · {a.actorName ?? "system"}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <div className="break-words whitespace-pre-wrap">{value}</div>
    </div>
  );
}

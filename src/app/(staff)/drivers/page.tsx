import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermissionPage } from "@/lib/bookings/page";
import { listDrivers } from "@/lib/drivers/service";
import { DriversTable } from "./drivers-table";

export const metadata: Metadata = { title: "Drivers" };

export default async function DriversPage() {
  await requirePermissionPage("drivers.manage");
  const drivers = await listDrivers();
  return (
    <>
      <PageHeader title="Drivers" description="Drivers for With Driver trips. They are not system users." />
      <DriversTable drivers={drivers.map((d) => ({ id: d.id, name: d.name, phone: d.phone, active: d.active, notes: d.notes, source: d.source }))} />
    </>
  );
}

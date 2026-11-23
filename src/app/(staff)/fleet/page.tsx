import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { listVehicles } from "@/lib/fleet/service";
import { can } from "@/lib/permissions";
import { FleetTable } from "./fleet-table";

export const metadata: Metadata = { title: "Fleet" };

export default async function FleetPage() {
  const { user, allowed } = await requirePage("fleet.view");
  if (!allowed) return <NoAccess />;
  const rows = await listVehicles();
  const canEdit = can(user, "fleet.edit");
  return (
    <>
      <PageHeader
        title="Fleet"
        description={canEdit ? "Vehicles, ownership and display order." : "Read-only. Only a Super Admin can edit the fleet."}
      />
      <FleetTable
        canEdit={canEdit}
        vehicles={rows.map((v) => ({ ...v, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() }))}
      />
    </>
  );
}

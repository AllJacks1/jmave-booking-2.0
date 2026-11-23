import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { getClient } from "@/lib/clients/service";
import { formatPhPhone } from "@/lib/phone";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await requirePage("clients.edit");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getClient(id);
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.fullName}`} />
      <ClientForm
        id={c.id}
        initial={{
          fullName: c.fullName,
          fbName: c.fbName ?? "",
          phone: c.phone ? formatPhPhone(c.phone) : "",
          email: c.email ?? "",
          birthday: c.birthday ?? "",
          address: c.address ?? "",
          altContactName: c.altContactName ?? "",
          altContactPhone: c.altContactPhone ? formatPhPhone(c.altContactPhone) : "",
          driversLicenseNo: c.driversLicenseNo ?? "",
          companyName: c.companyName ?? "",
          clientType: c.clientType,
          notes: c.notes ?? "",
        }}
      />
    </>
  );
}

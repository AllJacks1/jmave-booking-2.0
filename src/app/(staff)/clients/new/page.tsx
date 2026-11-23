import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const { allowed } = await requirePage("clients.edit");
  if (!allowed) return <NoAccess />;
  return (
    <>
      <PageHeader title="New client" description="Phone numbers are saved in +63 format." />
      <ClientForm />
    </>
  );
}

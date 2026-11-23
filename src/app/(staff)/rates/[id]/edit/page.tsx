import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { getActiveRateCard, getRateCard } from "@/lib/rates/service";
import { RateCardEditor } from "./rate-card-editor";

export const metadata: Metadata = { title: "Edit rate card" };

export default async function EditRateCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await requirePage("rates.edit");
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [card, active] = await Promise.all([getRateCard(id), getActiveRateCard()]);
  if (!card) notFound();
  if (card.status !== "draft") redirect(`/rates/${id}`);

  return (
    <>
      <PageHeader
        title={`Edit v${card.version}`}
        description={`Amounts in pesos, percentages in %. Highlighted cells differ from ${active ? `active v${active.version}` : "the starting values"}.`}
      />
      <RateCardEditor id={card.id} name={card.name} notes={card.notes ?? ""} data={card.data} compareTo={active?.data ?? card.data} />
    </>
  );
}

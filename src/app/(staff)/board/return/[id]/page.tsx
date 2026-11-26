import type { Metadata } from "next";
import { CheckInPage } from "../../check-in-page";

export const metadata: Metadata = { title: "Return" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckInPage mode="return" id={id} />;
}

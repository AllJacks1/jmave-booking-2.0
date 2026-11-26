import type { Metadata } from "next";
import { CheckInPage } from "../../check-in-page";

export const metadata: Metadata = { title: "Release" };

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckInPage mode="release" id={id} />;
}

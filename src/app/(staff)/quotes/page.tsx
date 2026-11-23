import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Quotations" };

export default function Page() {
  return <PlaceholderPage href="/quotes" />;
}

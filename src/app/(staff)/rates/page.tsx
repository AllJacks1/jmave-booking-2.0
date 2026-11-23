import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Rates" };

export default function Page() {
  return <PlaceholderPage href="/rates" />;
}

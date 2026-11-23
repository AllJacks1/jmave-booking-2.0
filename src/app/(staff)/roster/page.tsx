import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Roster" };

export default function Page() {
  return <PlaceholderPage href="/roster" />;
}

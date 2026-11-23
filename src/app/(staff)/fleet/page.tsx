import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Fleet" };

export default function Page() {
  return <PlaceholderPage href="/fleet" />;
}

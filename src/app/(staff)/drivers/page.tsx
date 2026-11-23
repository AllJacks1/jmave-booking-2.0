import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Drivers" };

export default function Page() {
  return <PlaceholderPage href="/drivers" />;
}

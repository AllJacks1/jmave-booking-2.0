import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <PlaceholderPage href="/audit" />;
}

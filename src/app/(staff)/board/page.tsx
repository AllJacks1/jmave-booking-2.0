import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Movement board" };

export default function Page() {
  return <PlaceholderPage href="/board" />;
}

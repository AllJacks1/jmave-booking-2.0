import { CalculatorIcon, CalendarDaysIcon, GitCompareIcon, TableIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/rates", label: "Rate cards", icon: TableIcon },
  { href: "/rates/compare", label: "Compare", icon: GitCompareIcon },
  { href: "/rates/holidays", label: "Holidays", icon: CalendarDaysIcon },
  { href: "/rates/playground", label: "Playground", icon: CalculatorIcon },
];

export function RatesNav({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Rates sections">
      {LINKS.map((l) => (
        <Button key={l.href} asChild size="sm" variant={l.href === current ? "secondary" : "ghost"}>
          <Link href={l.href} aria-current={l.href === current ? "page" : undefined}>
            <l.icon />
            {l.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

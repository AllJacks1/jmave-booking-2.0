import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { rosterWeek } from "@/lib/roster/service";
import { addDaysToKey, formatManilaDate, isDateKey, manilaDateKey, weekdayShort } from "@/lib/time";
import { RosterGrid } from "./roster-grid";

export const metadata: Metadata = { title: "Roster" };

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { user, allowed } = await requirePage("roster.view");
  if (!allowed) return <NoAccess />;
  const sp = await searchParams;
  const today = manilaDateKey(new Date());
  const anchor = sp.week && isDateKey(sp.week) ? sp.week : today;
  const w = await rosterWeek(anchor);
  const editable = can(user, "roster.edit");

  return (
    <>
      <PageHeader
        title="Shift roster"
        description={`Week of ${formatManilaDate(w.monday)}${editable ? "" : " · view only"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label="Previous week">
              <Link href={`/roster?week=${addDaysToKey(w.monday, -7)}`}>
                <ChevronLeftIcon />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/roster">This week</Link>
            </Button>
            <Button asChild variant="outline" size="icon" aria-label="Next week">
              <Link href={`/roster?week=${addDaysToKey(w.monday, 7)}`}>
                <ChevronRightIcon />
              </Link>
            </Button>
          </div>
        }
      />
      <RosterGrid
        week={w.monday}
        days={w.days}
        dayLabels={w.days.map((d) => `${weekdayShort(d)} ${d.slice(5)}`)}
        templates={w.templates}
        entries={w.entries.map((e) => ({ date: e.date, userId: e.userId, templateId: e.templateId, duty: e.duty }))}
        people={w.people}
        editable={editable}
        today={today}
      />
    </>
  );
}

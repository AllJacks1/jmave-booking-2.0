import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { holidayYears, listHolidays } from "@/lib/rates/service";
import { manilaYear } from "@/lib/time";
import { RatesNav } from "../rates-nav";
import { HolidaysClient } from "./holidays-client";

export const metadata: Metadata = { title: "Holidays" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { user, allowed } = await requirePage("rates.view");
  if (!allowed) return <NoAccess />;
  const sp = await searchParams;
  const thisYear = manilaYear(new Date());
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : thisYear;
  const [rows, years] = await Promise.all([listHolidays(year), holidayYears()]);
  const yearOptions = [...new Set([...years, thisYear, thisYear + 1, year])].sort();
  const canEdit = can(user, "rates.edit");

  return (
    <>
      <PageHeader
        title="Holidays"
        description={
          canEdit
            ? "With Driver trips that start on a holiday get the holiday driver fee."
            : "Read-only. Only a Super Admin can change holidays."
        }
      />
      <RatesNav current="/rates/holidays" />
      <HolidaysClient year={year} years={yearOptions} canEdit={canEdit} holidays={rows.map((h) => ({ id: h.id, date: h.date, name: h.name }))} />
    </>
  );
}

"use client";

import { TriangleAlertIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatValue, fromInput, getPath, toInput } from "@/lib/pricing/paths";
import type { RateCardData } from "@/lib/pricing/rate-card";
import {
  BODY_TYPE_LABELS,
  BODY_TYPES,
  RATE_KEY_LABELS,
  RATE_KEYS,
  SERVICE_AREA_LABELS,
  SERVICE_AREAS,
} from "@/lib/pricing/types";

type Props = {
  data: RateCardData;
  /** Editing: called with the path and the new stored value (null = blank). */
  onChange?: (path: string, value: number | null) => void;
  /** Highlight cells that differ from this card. */
  compareTo?: RateCardData;
  /** Validation errors keyed by path (`[0]` form). */
  errors?: Record<string, string>;
};

/** The rate card as readable tables (same layout as pricing.md). */
const CardContext = createContext<Props | null>(null);

/** One value cell: text, or an input when editing; highlighted when it differs. */
function V({ path, suffix }: { path: string; suffix?: string }) {
  const { data, onChange, compareTo, errors } = useContext(CardContext)!;
  const value = getPath(data, path);
  const before = compareTo ? getPath(compareTo, path) : undefined;
  const changed = compareTo !== undefined && before !== value;
  const error = errors?.[path];
  if (onChange) {
    return (
      <div className="flex flex-col gap-0.5">
        <input
          aria-label={path}
          inputMode="decimal"
          className={`h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${error ? "border-destructive" : ""} ${changed ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}
          defaultValue={toInput(path, value)}
          onChange={(e) => onChange(path, fromInput(path, e.target.value))}
        />
        {error ? <span className="max-w-24 text-xs text-destructive">{error}</span> : null}
      </div>
    );
  }
  return (
    <span
      className={`tabular-nums ${changed ? "rounded bg-amber-100 px-1 font-medium dark:bg-amber-900/50" : ""}`}
      title={changed ? `Was ${formatValue(path, before)}` : undefined}
      data-changed={changed || undefined}
    >
      {formatValue(path, value)}
      {suffix}
      {changed ? (
        <span className="ml-1 text-xs text-muted-foreground line-through">{formatValue(path, before)}</span>
      ) : null}
    </span>
  );
}

export function RateCardTables(props: Props) {
  const { data } = props;
  const wagonCity = data.withDriver.longTerm.wagon.within_davao_city.d30;
  const mpvCity = data.withDriver.longTerm.mpv.within_davao_city.d30;

  return (
    <CardContext.Provider value={props}>
      <div className="flex flex-col gap-6">
        <Section title="Vehicle classes" description="Shared by both services. Money in pesos.">
          <Grid
            head={["Body type", "km per liter", "Carwash", "CDW per day", "Excess ₱/km"]}
            rows={BODY_TYPES.map((b) => [
              BODY_TYPE_LABELS[b],
              <V key="k" path={`vehicleClasses.${b}.kmPerLiter`} />,
              <V key="c" path={`vehicleClasses.${b}.carwash`} />,
              <V key="d" path={`vehicleClasses.${b}.cdwPerDay`} />,
              <V key="e" path={`vehicleClasses.${b}.excessPerKm`} />,
            ])}
          />
          <Grid
            head={["Setting", "Value"]}
            rows={[
              ["Mileage allowance (km per rental day)", <V key="m" path="mileageAllowanceKmPerDay" />],
              ["Terminal fee (card only)", <V key="t" path="terminalFeeBps" />],
            ]}
          />
        </Section>

        <Section title="Self-Drive — daily rates">
          <Grid
            head={["Rate", "24h", "12h", "8h", "Add'l 8h", "Add'l 12h"]}
            rows={RATE_KEYS.map((k) => [
              RATE_KEY_LABELS[k],
              <V key="a" path={`selfDrive.daily.${k}.h24`} />,
              <V key="b" path={`selfDrive.daily.${k}.h12`} />,
              <V key="c" path={`selfDrive.daily.${k}.h8`} />,
              <V key="d" path={`selfDrive.additionalHours.${k}.h8`} />,
              <V key="e" path={`selfDrive.additionalHours.${k}.h12`} />,
            ])}
          />
        </Section>

        <Section title="Self-Drive — extras, promos and discounts">
          <Grid
            head={["Body type", "Hourly extension"]}
            rows={BODY_TYPES.map((b) => [BODY_TYPE_LABELS[b], <V key="h" path={`selfDrive.hourlyExtension.${b}`} />])}
          />
          <Grid
            head={["Rule", "Value"]}
            rows={[
              ["7-day discount (off the daily rate)", <V key="1" path="selfDrive.sevenDayDiscountPerDay" />],
              ["7-day discount from (days)", <V key="2" path="selfDrive.sevenDayMinDays" />],
              ["OT premium 7:01 PM – 1:00 AM", <V key="3" path="selfDrive.otPremium.evening" />],
              ["OT premium 1:01 AM – 6:00 AM", <V key="4" path="selfDrive.otPremium.overnight" />],
              ["Beyond operating hours (per day)", <V key="5" path="selfDrive.beyondOperatingHoursPerDay" />],
              ["New-client discount", <V key="6" path="selfDrive.newClientDiscountBps" />],
              ["April promo, short trips", <V key="7" path="selfDrive.promos.aprilTiered.shortBps" />],
              ["April promo, long trips", <V key="8" path="selfDrive.promos.aprilTiered.longBps" />],
              ["April promo long rate from (days)", <V key="9" path="selfDrive.promos.aprilTiered.longFromDays" />],
              ["City Saver (flat per booking)", <V key="10" path="selfDrive.promos.citySaver" />],
              ["City Saver Plus (flat per booking)", <V key="11" path="selfDrive.promos.citySaverPlus" />],
            ]}
          />
        </Section>

        <Section title="With Driver — daily rates (1–14 days)">
          <Grid
            head={["Rate", "24h", "12h", "10h", "8h", "Add'l 8h (car)", "Add'l 12h (car)"]}
            rows={RATE_KEYS.map((k) => [
              RATE_KEY_LABELS[k],
              <V key="a" path={`withDriver.daily.${k}.h24`} />,
              <V key="b" path={`withDriver.daily.${k}.h12`} />,
              <V key="c" path={`withDriver.daily.${k}.h10`} />,
              <V key="d" path={`withDriver.daily.${k}.h8`} />,
              <V key="e" path={`withDriver.additionalHoursCar.${k}.h8`} />,
              <V key="f" path={`withDriver.additionalHoursCar.${k}.h12`} />,
            ])}
          />
        </Section>

        <Section
          title="With Driver — long-term daily rate"
          description={
            <>
              15–29 days and 30+ days, by service area. Applies from <V path="withDriver.longTermFromDays" /> and{" "}
              <V path="withDriver.longTermFullFromDays" /> days.
            </>
          }
        >
          {wagonCity > mpvCity ? (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon className="size-4" />
              Wagon “Within Davao City” is higher than MPV (as in the old sheet). Check with the owner.
            </p>
          ) : null}
          <Grid
            head={[
              "Body type",
              ...SERVICE_AREAS.flatMap((a) => [`${SERVICE_AREA_LABELS[a]} 30+`, `${SERVICE_AREA_LABELS[a]} 15–29`]),
            ]}
            rows={BODY_TYPES.map((b) => [
              BODY_TYPE_LABELS[b],
              ...SERVICE_AREAS.flatMap((a) => [
                <V key={`${a}30`} path={`withDriver.longTerm.${b}.${a}.d30`} />,
                <V key={`${a}15`} path={`withDriver.longTerm.${b}.${a}.d15to29`} />,
              ]),
            ])}
          />
        </Section>

        <Section
          title="With Driver — driver fee by one-way distance"
          description="Above the last band, the last band applies. The 8h and 12h rows also price additional driver hours."
        >
          <Grid
            head={[
              "Hours",
              ...data.withDriver.driverFee.bandMaxKm.map((_, i) => (
                <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                  ≤ <V path={`withDriver.driverFee.bandMaxKm[${i}]`} /> km
                </span>
              )),
            ]}
            rows={(["h8", "h10", "h12", "h24"] as const).map((t) => [
              t.slice(1) + "h",
              ...data.withDriver.driverFee[t].map((_, i) => <V key={i} path={`withDriver.driverFee.${t}[${i}]`} />),
            ])}
          />
        </Section>

        <Section title="With Driver — rules and fees">
          <Grid
            head={["Rule", "Value"]}
            rows={[
              ["Working-hour driver fee", <V key="1" path="withDriver.workingHourFee" />],
              ["Working hour allowed under (km one way)", <V key="2" path="withDriver.workingHourMaxKm" />],
              ["Holiday multiplier on driver fee", <V key="3" path="withDriver.holidayMultiplier" suffix="×" />],
              ["Standby deduction (long-term parking)", <V key="4" path="withDriver.standbyDeduction" />],
              ["Service fee", <V key="5" path="withDriver.serviceFee" />],
              ["Rounding step", <V key="6" path="withDriver.roundingStep" />],
              ["Fuel km factor (round trip + 10%)", <V key="7" path="withDriver.fuelFactorTenths" />],
              ["Night differential (22:01–06:00)", <V key="8" path="withDriver.nightDiffBps" />],
            ]}
          />
          <Grid
            head={["Body type", "Excess hour, renter's fuel", "Excess hour, all-in", "Pick-up/drop-off (unused)"]}
            rows={BODY_TYPES.map((b) => [
              BODY_TYPE_LABELS[b],
              <V key="r" path={`withDriver.excessHourRates.${b}.rentersFuel`} />,
              <V key="a" path={`withDriver.excessHourRates.${b}.allIn`} />,
              <V key="p" path={`withDriver.unused.pickupDropoffRate.${b}`} />,
            ])}
          />
          <Grid
            head={["Van distance rate (stored, unused)", "Value"]}
            rows={[
              ["1–150 km", <V key="1" path="withDriver.unused.vanDistanceRate.upTo150Km" />],
              ["151+ km", <V key="2" path="withDriver.unused.vanDistanceRate.above150Km" />],
            ]}
          />
        </Section>
      </div>
    </CardContext.Provider>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function Grid({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={i} className={i === 0 ? undefined : "text-right"}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((c, j) => (
                <TableCell key={j} className={j === 0 ? "font-medium" : "text-right"}>
                  {j === 0 ? c : <div className="flex justify-end">{c}</div>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

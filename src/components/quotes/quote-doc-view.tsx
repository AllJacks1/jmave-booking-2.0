/**
 * The client copy as HTML (share page + staff view). Same content as the PDF
 * (docs/reference/quote-documents.md); renders only `QuoteDoc` fields, which
 * hold no internal data.
 */
import { Badge } from "@/components/ui/badge";
import { PRICING_BASIS_LABELS, SERVICE_AREA_LABELS, SERVICE_LABELS, WD_PACKAGE_LABELS } from "@/lib/pricing";
import {
  durationText,
  fmtDate,
  fmtDateTime,
  fmtPeso,
  fmtPhone,
  fmtTime,
  printedLabel,
  sdPayable,
  totalsFor,
  type QuoteDoc,
  type Totals,
} from "@/lib/quotes/document";
import {
  CLOSING,
  DEPOSIT_NOTE,
  ESTIMATE_NOTE,
  FOOTER,
  NIGHT_DIFF_TEXT,
  PACKAGE_DESCRIPTIONS,
  PAYABLE_NOTE,
  SD_PENDING,
  sdBookingInfo,
  validityHours,
  WD_PENDING,
  wdBookingInfo,
} from "@/lib/quotes/terms";
import type { ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-primary uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground uppercase">{k}</dt>
          <dd className="font-medium break-words">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Money({ rows }: { rows: Totals }) {
  return (
    <dl className="ml-auto flex w-full max-w-sm flex-col gap-1">
      {rows.map((t) => (
        <div key={t.label} className={`flex justify-between gap-4 ${t.strong ? "text-base font-semibold" : "text-sm"}`}>
          <dt>{t.label}</dt>
          <dd className="tabular-nums">{fmtPeso(t.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Lines({ doc }: { doc: QuoteDoc }) {
  const r = doc.result;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground uppercase">
            <th className="py-1.5 pr-2 font-normal">Item</th>
            <th className="hidden py-1.5 pr-2 font-normal sm:table-cell">Remarks</th>
            <th className="py-1.5 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {[...r.lines, ...r.discounts].map((l, i) => (
            <tr key={`${l.code}-${i}`} className="border-b align-top" data-testid="quote-line">
              <td className="py-1.5 pr-2">
                {printedLabel(l, doc)}
                {l.remark ? <div className="text-xs text-muted-foreground sm:hidden">{l.remark}</div> : null}
              </td>
              <td className="hidden py-1.5 pr-2 text-xs text-muted-foreground sm:table-cell">{l.remark}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtPeso(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function QuoteDocView({ doc }: { doc: QuoteDoc }) {
  const r = doc.result;
  const f = doc.form;
  const b = doc.business;
  const estimate = doc.kind === "quick" || !doc.number;
  const title = estimate ? "Rental Estimate" : r.service === "self_drive" ? "Self-Driven Rental Quotation" : "Quotation — With Driver";
  const hours = validityHours(doc);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-lg border bg-card p-5 text-card-foreground sm:p-8" data-testid="quote-doc">
      <header className="flex flex-col justify-between gap-3 border-b-2 border-primary pb-4 sm:flex-row">
        <p className="text-2xl font-bold text-primary">{b.name}</p>
        <div className="text-sm text-muted-foreground sm:text-right">
          <p>{b.address}</p>
          <p>
            Mobile: {fmtPhone(b.mobile)} · Landline: {fmtPhone(b.landline)}
          </p>
          <p>Email: {b.email}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="font-semibold text-primary" data-testid="quote-number">
          {doc.number ?? "ESTIMATE"}
        </p>
      </div>
      <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase">Issued</p>
          <p className="font-medium">{doc.issuedAt ? fmtDateTime(doc.issuedAt) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">Valid until</p>
          <p className="font-medium">{doc.validUntil ? fmtDateTime(doc.validUntil) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">Booking consultant</p>
          <p className="font-medium">{doc.consultantName ?? "—"}</p>
        </div>
      </div>

      {estimate ? (
        <>
          <Section title="Rental">
            <Grid
              items={[
                ...(doc.clientName ? ([["Client", doc.clientName]] as [string, ReactNode][]) : []),
                ["Service", SERVICE_LABELS[doc.service]],
                ["Vehicle", doc.vehicleLabel],
                ["Duration", durationText(doc)],
                [r.service === "self_drive" ? "Release" : "Start", fmtDateTime(doc.startAt)],
                [r.service === "self_drive" ? "Return" : "End", fmtDateTime(doc.endAt)],
                ["Destination", f.destination || f.dropoffPlace],
              ]}
            />
          </Section>
          <Section title="Charges">
            <Lines doc={doc} />
            <Money rows={[{ label: "Subtotal", amount: r.subtotal }, ...totalsFor(doc).filter((t) => t.label !== "Subtotal" && t.label !== "Sub total")]} />
          </Section>
          {r.service === "self_drive" && r.payable.deposit ? <p className="text-sm">Refundable security deposit upon release: {fmtPeso(r.payable.deposit)}</p> : null}
          <p className="border-l-4 border-primary pl-3 text-sm">{ESTIMATE_NOTE}</p>
        </>
      ) : r.service === "self_drive" ? (
        <>
          <Section title="Booking status">
            <Badge variant="secondary" className="w-fit">
              Pending
            </Badge>
            <p className="text-sm">{SD_PENDING}</p>
          </Section>
          <Section title="Rental details">
            <Grid
              items={[
                ["Booking date", doc.issuedAt ? fmtDate(doc.issuedAt) : null],
                ["CDW", r.inputs.withCdw ? "With CDW" : "Without CDW"],
                ["Vehicle release", `${fmtDate(doc.startAt)}, ${fmtTime(doc.startAt)}`],
                ["Vehicle return", `${fmtDate(doc.endAt)}, ${fmtTime(doc.endAt)}`],
              ]}
            />
          </Section>
          <Section title="Vehicle details">
            <Grid
              items={[
                ["Car", doc.vehicleLabel],
                ["Category", doc.categoryLabel ?? "Standard"],
                ["Time duration", durationText(doc)],
                ["Days", String(r.inputs.days)],
              ]}
            />
          </Section>
          <Section title="Client details">
            <Grid
              items={[
                ["Name", doc.clientName],
                ["Facebook name", doc.clientFbName],
              ]}
            />
          </Section>
          <Section title="Authorized area of use">
            <Grid
              items={[
                ["From", f.areaFrom || "Davao City"],
                ["To", f.destination],
              ]}
            />
          </Section>
          <Section title="Detailed breakdown of charges">
            <Lines doc={doc} />
            <Money rows={totalsFor(doc)} />
          </Section>
          {r.payable.deposit ? (
            <Section title="Deposit">
              <Money rows={[{ label: "Refundable security deposit", amount: r.payable.deposit }]} />
              <p className="text-sm text-muted-foreground">{DEPOSIT_NOTE}</p>
            </Section>
          ) : null}
          <Section title="Amounts payable">
            <p className="text-sm text-muted-foreground">{PAYABLE_NOTE}</p>
            <Money rows={sdPayable(doc) ?? []} />
          </Section>
          <Section title="Booking information">
            <Bullets items={sdBookingInfo(hours)} />
          </Section>
        </>
      ) : (
        <>
          <Section title="Reservation status">
            <Badge variant="secondary" className="w-fit">
              Pending
            </Badge>
            <p className="text-sm">{WD_PENDING}</p>
          </Section>
          <Grid
            items={[
              ["Booking date", doc.issuedAt ? fmtDate(doc.issuedAt) : null],
              ["Travel date", fmtDate(doc.startAt)],
            ]}
          />
          <Section title="Travel details">
            <Grid
              items={[
                ["Quotation no.", doc.number],
                ["Car", doc.vehicleLabel],
                ["Pricing basis", PRICING_BASIS_LABELS[r.inputs.pricingBasis]],
                ["Reserved package", `${r.hoursTier} consecutive hours`],
                ["Service area", SERVICE_AREA_LABELS[r.inputs.serviceArea]],
                ["Number of days", String(r.billingDays)],
                ["Trip type", WD_PACKAGE_LABELS[r.inputs.package]],
              ]}
            />
          </Section>
          <Section title="Trip details">
            <Grid
              items={[
                ["Pick-up place", f.pickupPlace],
                ["Drop-off place", f.dropoffPlace || f.destination],
                ["Pick-up date", fmtDate(doc.startAt)],
                ["Drop-off date", fmtDate(doc.endAt)],
                ["Pick-up time", fmtTime(doc.startAt)],
                ["Scheduled return time", fmtTime(doc.endAt)],
                ...(f.itinerary ? ([["Itinerary", f.itinerary]] as [string, ReactNode][]) : []),
              ]}
            />
          </Section>
          <Section title="Client and driver">
            <Grid
              items={[
                ["Client", doc.clientName],
                ["Driver", f.driverName ? [f.driverName, f.driverContact].filter(Boolean).join(" · ") : "To be assigned upon confirmation"],
              ]}
            />
          </Section>
          <Section title="Charges">
            <Lines doc={doc} />
            <Money rows={totalsFor(doc)} />
          </Section>
          <Section title="Supplemental charges (not included in the total)">
            <Grid
              items={[
                ["Excess hour", r.supplemental[0] ? `${doc.bodyLabel} ${fmtPeso(r.supplemental[0].amount)} / hr (${r.supplemental[0].remark})` : null],
                ["Night differential", NIGHT_DIFF_TEXT],
                ["Parking and toll fees", "Actual cost"],
                ["Incidental charges", "Actual cost"],
              ]}
            />
          </Section>
          <Section title="Booking information">
            <Bullets items={wdBookingInfo(hours)} />
          </Section>
          <Section title={`Package: ${PACKAGE_DESCRIPTIONS[r.inputs.package].title}`}>
            <p className="text-sm">{PACKAGE_DESCRIPTIONS[r.inputs.package].text}</p>
          </Section>
        </>
      )}

      <div className="flex flex-col gap-2 text-sm">
        {!estimate ? (
          <Grid
            items={[
              ["Valid until", doc.validUntil ? fmtDateTime(doc.validUntil) : null],
              ["Your booking consultant", doc.consultantName],
            ]}
          />
        ) : null}
        <p>{CLOSING}</p>
      </div>
      <footer className="border-t pt-3 text-center text-xs text-muted-foreground">{FOOTER}</footer>
    </article>
  );
}

/**
 * Quotation PDFs (docs/reference/quote-documents.md §1–§3), A4 portrait,
 * rendered on request from the stored result. Server only.
 */
import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ComponentProps, ReactNode } from "react";
import {
  PRICING_BASIS_LABELS,
  SERVICE_AREA_LABELS,
  SERVICE_LABELS,
  WD_PACKAGE_LABELS,
  type PriceLine,
} from "@/lib/pricing";
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

// Geist has the ₱ glyph; the built-in PDF fonts do not.
const FONT_DIR = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans");
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(FONT_DIR, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "Geist-SemiBold.ttf"), fontWeight: 600 },
    { src: path.join(FONT_DIR, "Geist-Bold.ttf"), fontWeight: 700 },
  ],
});
// Never split words with hyphens (names, plate numbers).
Font.registerHyphenationCallback((word) => [word]);

const LOGO = path.join(process.cwd(), "public", "brand", "logo.png");

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#b91c1c";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: INK, paddingTop: 32, paddingBottom: 72, paddingHorizontal: 36, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: ACCENT, paddingBottom: 10, marginBottom: 12 },
  wordmark: { fontSize: 20, fontWeight: 700, color: ACCENT, letterSpacing: 0.5 },
  logo: { width: 140, height: 48, objectFit: "contain" },
  biz: { alignItems: "flex-end", maxWidth: 260 },
  bizName: { fontSize: 11, fontWeight: 700 },
  bizLine: { color: MUTED, fontSize: 8.5, textAlign: "right" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  title: { fontSize: 15, fontWeight: 700 },
  number: { fontSize: 11, fontWeight: 700, color: ACCENT },
  meta: { flexDirection: "row", flexWrap: "wrap", backgroundColor: "#f9fafb", borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, marginBottom: 12 },
  metaCell: { width: "25%", paddingRight: 6 },
  label: { color: MUTED, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 9, fontWeight: 600 },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ACCENT, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell2: { width: "50%", paddingRight: 8, marginBottom: 4 },
  cell3: { width: "33.33%", paddingRight: 8, marginBottom: 4 },
  cellFull: { width: "100%", marginBottom: 4 },
  table: { borderTopWidth: 1, borderTopColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3 },
  thText: { color: MUTED, fontSize: 7.5, textTransform: "uppercase" },
  colLabel: { width: "38%", paddingRight: 6 },
  colRemark: { width: "40%", paddingRight: 6, color: MUTED, fontSize: 8 },
  colAmount: { width: "22%", textAlign: "right", fontFamily: "Geist" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 2 },
  totalLabel: { width: "40%", textAlign: "right", paddingRight: 8 },
  totalAmount: { width: "22%", textAlign: "right" },
  strong: { fontWeight: 700, fontSize: 10.5 },
  badge: { alignSelf: "flex-start", paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "#fef3c7", color: "#92400e", fontSize: 8.5, fontWeight: 700, marginBottom: 4 },
  note: { color: MUTED, fontSize: 8.5 },
  bulletRow: { flexDirection: "row", marginBottom: 2 },
  bullet: { width: 10 },
  bulletText: { flex: 1 },
  callout: { borderLeftWidth: 3, borderLeftColor: ACCENT, paddingLeft: 8, paddingVertical: 4, marginBottom: 10 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 34, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, color: MUTED, fontSize: 7, textAlign: "center" },
});

function Header({ doc }: { doc: QuoteDoc }) {
  const b = doc.business;
  return (
    <View style={s.header} fixed>
      {existsSync(LOGO) ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
        <Image src={LOGO} style={s.logo} />
      ) : (
        <Text style={s.wordmark}>{b.name}</Text>
      )}
      <View style={s.biz}>
        {existsSync(LOGO) ? <Text style={s.bizName}>{b.name}</Text> : null}
        <Text style={s.bizLine}>{b.address}</Text>
        <Text style={s.bizLine}>
          Mobile: {fmtPhone(b.mobile)} · Landline: {fmtPhone(b.landline)}
        </Text>
        <Text style={s.bizLine}>Email: {b.email}</Text>
      </View>
    </View>
  );
}

function Footer() {
  return (
    <Text style={s.footer} fixed>
      {FOOTER}
    </Text>
  );
}

function Field({ label, value, style = s.cell2 }: { label: string; value: ReactNode; style?: ComponentProps<typeof View>["style"] }) {
  return (
    <View style={style} wrap={false}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value === null || value === undefined || value === "" ? "—" : value}</Text>
    </View>
  );
}

/** `keep`: never split this section across pages (short blocks). */
function Section({ title, children, keep = false }: { title: string; children: ReactNode; keep?: boolean }) {
  return (
    <View style={s.section} wrap={!keep}>
      <Text style={s.sectionTitle} minPresenceAhead={40}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Meta({ doc, title }: { doc: QuoteDoc; title: string }) {
  return (
    <>
      <View style={s.titleRow}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.number}>{doc.number ?? "ESTIMATE"}</Text>
      </View>
      <View style={s.meta}>
        <Field style={s.metaCell} label={doc.number ? "Quotation no." : "Estimate"} value={doc.number ?? "ESTIMATE"} />
        <Field style={s.metaCell} label="Issued" value={doc.issuedAt ? fmtDateTime(doc.issuedAt) : null} />
        <Field style={s.metaCell} label="Valid until" value={doc.validUntil ? fmtDateTime(doc.validUntil) : null} />
        <Field style={s.metaCell} label="Booking consultant" value={doc.consultantName} />
      </View>
    </>
  );
}

function Lines({ doc, lines }: { doc: QuoteDoc; lines: PriceLine[] }) {
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>
        <Text style={[s.colLabel, s.thText]}>Item</Text>
        <Text style={[s.colRemark, s.thText]}>Remarks</Text>
        <Text style={[s.colAmount, s.thText]}>Amount</Text>
      </View>
      {lines.map((l, i) => (
        <View key={`${l.code}-${i}`} style={s.tr} wrap={false}>
          <Text style={s.colLabel}>{printedLabel(l, doc)}</Text>
          <Text style={s.colRemark}>{l.remark}</Text>
          <Text style={s.colAmount}>{fmtPeso(l.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function TotalsBlock({ rows }: { rows: Totals }) {
  return (
    <View wrap={false} style={{ marginTop: 4 }}>
      {rows.map((t) => (
        <View key={t.label} style={s.totalRow}>
          <Text style={[s.totalLabel, t.strong ? s.strong : {}]}>{t.label}</Text>
          <Text style={[s.totalAmount, t.strong ? s.strong : {}]}>{fmtPeso(t.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((t) => (
        <View key={t} style={s.bulletRow} wrap={false}>
          <Text style={s.bullet}>•</Text>
          <Text style={s.bulletText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function Closing({ doc }: { doc: QuoteDoc }) {
  return (
    <View wrap={false} style={{ marginTop: 6 }}>
      <View style={s.grid}>
        <Field label="Valid until" value={doc.validUntil ? fmtDateTime(doc.validUntil) : null} />
        <Field label="Your booking consultant" value={doc.consultantName} />
      </View>
      <Text style={{ marginTop: 6 }}>{CLOSING}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// §1 Estimate
// ---------------------------------------------------------------------------

function EstimateBody({ doc }: { doc: QuoteDoc }) {
  const r = doc.result;
  const f = doc.form;
  const totals: Totals = [{ label: "Subtotal", amount: r.subtotal }, ...totalsFor(doc).filter((t) => t.label !== "Subtotal" && t.label !== "Sub total")];
  return (
    <>
      <Meta doc={doc} title="Rental Estimate" />
      <Section title="Rental" keep>
        <View style={s.grid}>
          {doc.clientName ? <Field label="Client" value={doc.clientName} /> : null}
          <Field label="Service" value={SERVICE_LABELS[doc.service]} />
          <Field label="Vehicle" value={doc.vehicleLabel} />
          <Field label="Duration" value={durationText(doc)} />
          <Field label={doc.service === "self_drive" ? "Release" : "Start"} value={fmtDateTime(doc.startAt)} />
          <Field label={doc.service === "self_drive" ? "Return" : "End"} value={fmtDateTime(doc.endAt)} />
          <Field label="Destination" value={f.destination || f.dropoffPlace} />
          {doc.service === "with_driver" ? <Field label="Pricing basis" value={PRICING_BASIS_LABELS[f.pricingBasis]} /> : null}
        </View>
      </Section>
      <Section title="Charges">
        <Lines doc={doc} lines={[...r.lines, ...r.discounts]} />
        <TotalsBlock rows={totals} />
      </Section>
      {r.service === "self_drive" && r.payable.deposit > 0 ? (
        <Text style={{ marginBottom: 6 }}>Refundable security deposit upon release: {fmtPeso(r.payable.deposit)}</Text>
      ) : null}
      <View style={s.callout} wrap={false}>
        <Text>{ESTIMATE_NOTE}</Text>
      </View>
      <Text>{CLOSING}</Text>
    </>
  );
}

// ---------------------------------------------------------------------------
// §2 Formal — Self-Drive
// ---------------------------------------------------------------------------

function SelfDriveBody({ doc }: { doc: QuoteDoc }) {
  const r = doc.result;
  if (r.service !== "self_drive") return null;
  const f = doc.form;
  return (
    <>
      <Meta doc={doc} title="Self-Driven Rental Quotation" />
      <Section title="Booking status" keep>
        <Text style={s.badge}>Pending</Text>
        <Text>{SD_PENDING}</Text>
      </Section>
      <Section title="Rental details" keep>
        <View style={s.grid}>
          <Field label="Booking date" value={doc.issuedAt ? fmtDate(doc.issuedAt) : null} />
          <Field label="CDW" value={r.inputs.withCdw ? "With CDW" : "Without CDW"} />
          <Field label="Vehicle release" value={`${fmtDate(doc.startAt)}, ${fmtTime(doc.startAt)}`} />
          <Field label="Vehicle return" value={`${fmtDate(doc.endAt)}, ${fmtTime(doc.endAt)}`} />
        </View>
      </Section>
      <Section title="Vehicle details" keep>
        <View style={s.grid}>
          <Field label="Car" value={doc.vehicleLabel} />
          <Field label="Category" value={doc.categoryLabel ?? "Standard"} />
          <Field label="Time duration" value={durationText(doc)} />
          <Field label="Days" value={String(r.inputs.days)} />
        </View>
      </Section>
      <Section title="Client details" keep>
        <View style={s.grid}>
          <Field label="Name" value={doc.clientName} />
          <Field label="Facebook name" value={doc.clientFbName} />
        </View>
      </Section>
      <Section title="Authorized area of use" keep>
        <View style={s.grid}>
          <Field label="From" value={f.areaFrom || "Davao City"} />
          <Field label="To" value={f.destination} />
        </View>
      </Section>
      <Section title="Detailed breakdown of charges">
        <Lines doc={doc} lines={[...r.lines, ...r.discounts]} />
        <TotalsBlock rows={totalsFor(doc)} />
      </Section>
      {r.payable.deposit > 0 ? (
        <Section title="Deposit" keep>
          <View wrap={false}>
            <TotalsBlock rows={[{ label: "Refundable security deposit", amount: r.payable.deposit }]} />
            <Text style={s.note}>{DEPOSIT_NOTE}</Text>
          </View>
        </Section>
      ) : null}
      <Section title="Amounts payable" keep>
        <View wrap={false}>
          <Text style={s.note}>{PAYABLE_NOTE}</Text>
          <TotalsBlock rows={sdPayable(doc) ?? []} />
        </View>
      </Section>
      <Section title="Booking information">
        <Bullets items={sdBookingInfo(validityHours(doc))} />
      </Section>
      <Closing doc={doc} />
    </>
  );
}

// ---------------------------------------------------------------------------
// §3 Formal — With Driver
// ---------------------------------------------------------------------------

function WithDriverBody({ doc }: { doc: QuoteDoc }) {
  const r = doc.result;
  if (r.service !== "with_driver") return null;
  const f = doc.form;
  const pkg = PACKAGE_DESCRIPTIONS[r.inputs.package];
  const ehr = r.supplemental.find((l) => l.code === "excess_hour");
  const driver = f.driverName ? [f.driverName, f.driverContact].filter(Boolean).join(" · ") : "To be assigned upon confirmation";
  return (
    <>
      <Meta doc={doc} title="Quotation — With Driver" />
      <Section title="Reservation status" keep>
        <Text style={s.badge}>Pending</Text>
        <Text>{WD_PENDING}</Text>
      </Section>
      <View style={[s.grid, { marginBottom: 6 }]}>
        <Field label="Booking date" value={doc.issuedAt ? fmtDate(doc.issuedAt) : null} />
        <Field label="Travel date" value={fmtDate(doc.startAt)} />
      </View>
      <Section title="Travel details" keep>
        <View style={s.grid}>
          <Field style={s.cell3} label="Quotation no." value={doc.number} />
          <Field style={{ ...s.cell3, width: "66.66%" }} label="Car" value={doc.vehicleLabel} />
          <Field style={s.cell3} label="Pricing basis" value={PRICING_BASIS_LABELS[r.inputs.pricingBasis]} />
          <Field style={s.cell3} label="Reserved package" value={`${r.hoursTier} consecutive hours`} />
          <Field style={s.cell3} label="Service area" value={SERVICE_AREA_LABELS[r.inputs.serviceArea]} />
          <Field style={s.cell3} label="Number of days" value={String(r.billingDays)} />
          <Field style={s.cell3} label="Trip type" value={WD_PACKAGE_LABELS[r.inputs.package]} />
        </View>
      </Section>
      <Section title="Trip details" keep>
        <View style={s.grid}>
          <Field label="Pick-up place" value={f.pickupPlace} />
          <Field label="Drop-off place" value={f.dropoffPlace || f.destination} />
          <Field label="Pick-up date" value={fmtDate(doc.startAt)} />
          <Field label="Drop-off date" value={fmtDate(doc.endAt)} />
          <Field label="Pick-up time" value={fmtTime(doc.startAt)} />
          <Field label="Scheduled return time" value={fmtTime(doc.endAt)} />
          {f.itinerary ? <Field style={s.cellFull} label="Itinerary" value={f.itinerary} /> : null}
        </View>
      </Section>
      <View style={s.grid}>
        <View style={s.cell2}>
          <Section title="Client details" keep>
            <Field style={s.cellFull} label="Name" value={doc.clientName} />
          </Section>
        </View>
        <View style={s.cell2}>
          <Section title="Driver details">
            <Field style={s.cellFull} label="Driver" value={driver} />
          </Section>
        </View>
      </View>
      <Section title="Charges">
        <Lines doc={doc} lines={[...r.lines, ...r.discounts]} />
        <TotalsBlock rows={totalsFor(doc)} />
      </Section>
      <Section title="Supplemental charges (not included in the total)" keep>
        <View style={s.grid}>
          <Field label="Excess hour" value={ehr ? `${doc.bodyLabel} ${fmtPeso(ehr.amount)} / hr (${ehr.remark})` : null} />
          <Field label="Night differential" value={NIGHT_DIFF_TEXT} />
          <Field label="Parking and toll fees" value="Actual cost" />
          <Field label="Incidental charges" value="Actual cost" />
        </View>
      </Section>
      <Section title="Booking information">
        <Bullets items={wdBookingInfo(validityHours(doc))} />
      </Section>
      <Section title={`Package: ${pkg.title}`} keep>
        <Text>{pkg.text}</Text>
      </Section>
      <Closing doc={doc} />
    </>
  );
}

export function QuotationPdf({ doc }: { doc: QuoteDoc }) {
  const title = doc.number ? doc.number : "Rental Estimate";
  return (
    <Document title={title} author={doc.business.name} creator={doc.business.name} producer={doc.business.name}>
      <Page size="A4" style={s.page}>
        <Header doc={doc} />
        {doc.kind === "quick" || !doc.number ? (
          <EstimateBody doc={doc} />
        ) : doc.service === "self_drive" ? (
          <SelfDriveBody doc={doc} />
        ) : (
          <WithDriverBody doc={doc} />
        )}
        <Footer />
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(doc: QuoteDoc): Promise<Buffer> {
  return renderToBuffer(<QuotationPdf doc={doc} />);
}

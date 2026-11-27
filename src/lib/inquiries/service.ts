/**
 * Staff inbox for public booking requests (Phase 4 brief §5, Sales+).
 * New → (issue the draft quotation) quoted → (convert) converted, or
 * rejected with a reason. Status changes on issue and convert happen in the
 * quotation and booking services.
 */
import "server-only";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, inquiries, INQUIRY_STATUSES, outbox, quotations, user, vehicles, type InquiryStatus } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { detailsSchema, searchSchema, type Details, type Search } from "@/lib/public/schema";
import type { Attribution } from "@/lib/rework/payload";

export const INQUIRIES_PAGE_SIZE = 50;

export const inquiryListSchema = z.object({
  status: z.enum(["all", ...INQUIRY_STATUSES]).catch("new").default("new"),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});

export async function countNewInquiries(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(inquiries).where(eq(inquiries.status, "new"));
  return n;
}

export async function listInquiries(q: z.output<typeof inquiryListSchema>) {
  const where: SQL | undefined = q.status === "all" ? undefined : eq(inquiries.status, q.status);
  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        id: inquiries.id,
        reference: inquiries.reference,
        status: inquiries.status,
        service: inquiries.service,
        startAt: inquiries.startAt,
        endAt: inquiries.endAt,
        createdAt: inquiries.createdAt,
        shownTotalCentavos: inquiries.shownTotalCentavos,
        clientName: clients.fullName,
        clientBlacklisted: clients.isBlacklisted,
        vehicleName: vehicles.displayName,
        quotationNumber: quotations.number,
      })
      .from(inquiries)
      .leftJoin(clients, eq(clients.id, inquiries.clientId))
      .leftJoin(vehicles, eq(vehicles.id, inquiries.vehicleId))
      .leftJoin(quotations, eq(quotations.id, inquiries.quotationId))
      .where(where)
      .orderBy(q.status === "new" ? asc(inquiries.createdAt) : desc(inquiries.createdAt))
      .limit(INQUIRIES_PAGE_SIZE)
      .offset((q.page - 1) * INQUIRIES_PAGE_SIZE),
    db.select({ total: count() }).from(inquiries).where(where),
    db.select({ status: inquiries.status, n: count() }).from(inquiries).groupBy(inquiries.status),
  ]);
  const byStatus = Object.fromEntries(INQUIRY_STATUSES.map((s) => [s, 0])) as Record<InquiryStatus, number>;
  for (const c of counts) byStatus[c.status] = c.n;
  return { rows, total, byStatus };
}

export type InquiryView = Awaited<ReturnType<typeof getInquiry>>;

export async function getInquiry(id: string) {
  const [row] = await db.select().from(inquiries).where(eq(inquiries.id, id));
  if (!row) return null;
  const [[client], [vehicle], [quote], [reviewer], deliveries] = await Promise.all([
    row.clientId
      ? db
          .select({ id: clients.id, fullName: clients.fullName, phone: clients.phone, email: clients.email, isBlacklisted: clients.isBlacklisted, blacklistReason: clients.blacklistReason, source: clients.source, firstRentalAt: clients.firstRentalAt })
          .from(clients)
          .where(eq(clients.id, row.clientId))
      : Promise.resolve([]),
    row.vehicleId ? db.select({ id: vehicles.id, displayName: vehicles.displayName, plate: vehicles.plate }).from(vehicles).where(eq(vehicles.id, row.vehicleId)) : Promise.resolve([]),
    row.quotationId
      ? db.select({ id: quotations.id, number: quotations.number, status: quotations.status, totalCentavos: quotations.totalCentavos }).from(quotations).where(eq(quotations.id, row.quotationId))
      : Promise.resolve([]),
    row.reviewedBy ? db.select({ displayName: user.displayName }).from(user).where(eq(user.id, row.reviewedBy)) : Promise.resolve([]),
    db
      .select({ id: outbox.id, status: outbox.status, attempts: outbox.attempts, lastError: outbox.lastError, sentAt: outbox.sentAt, createdAt: outbox.createdAt })
      .from(outbox)
      .where(and(eq(outbox.entity, "inquiry"), eq(outbox.entityId, id)))
      .orderBy(desc(outbox.createdAt)),
  ]);
  const p = (row.payload ?? {}) as { search?: unknown; details?: unknown; consentAt?: string };
  const search = searchSchema.safeParse(p.search);
  const details = detailsSchema.safeParse(p.details);
  return {
    ...row,
    search: (search.success ? search.data : null) as Search | null,
    details: (details.success ? details.data : null) as Details | null,
    consentAt: p.consentAt ?? null,
    attribution: (row.utm ?? {}) as Attribution,
    requestMeta: (row.meta ?? {}) as { ip?: string | null; userAgent?: string | null },
    client: client ?? null,
    vehicle: vehicle ?? null,
    quotation: quote ?? null,
    reviewerName: reviewer?.displayName ?? null,
    deliveries,
  };
}

export const rejectInquirySchema = z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Give a reason").max(1000) });

/**
 * Reject a new or quoted request with a reason. A still-draft quotation is
 * cancelled with it; an issued one is left for staff to mark lost.
 */
export const rejectInquiry = defineAction({
  permission: "inquiries.manage",
  input: rejectInquirySchema,
  handler: async (actor, { id, reason }) => {
    return db.transaction(async (tx) => {
      const [cur] = await tx.select().from(inquiries).where(eq(inquiries.id, id)).for("update");
      if (!cur) throw new ActionError(404, "Request not found.");
      if (cur.status === "converted" || cur.status === "rejected") throw new ActionError(409, `This request is already ${cur.status}.`);
      const now = new Date();
      await tx.update(inquiries).set({ status: "rejected", rejectReason: reason, reviewedBy: actor.id, reviewedAt: now }).where(eq(inquiries.id, id));
      if (cur.quotationId) {
        const [q] = await tx.select({ id: quotations.id, status: quotations.status }).from(quotations).where(eq(quotations.id, cur.quotationId)).for("update");
        if (q?.status === "draft") {
          const note = `Request ${cur.reference} rejected: ${reason}`;
          await tx.update(quotations).set({ status: "cancelled", statusNote: note }).where(eq(quotations.id, q.id));
          await withAudit(actor, "quotation.cancel", "quotation", q.id, { status: "draft" }, { status: "cancelled", statusNote: note }, tx);
        }
      }
      await withAudit(actor, "inquiry.reject", "inquiry", id, { status: cur.status }, { status: "rejected", reason }, tx);
      return { id };
    });
  },
});

/** The website request behind a quotation, if any (banner on the quotation page). */
export async function inquiryForQuotation(quotationId: string) {
  const [row] = await db
    .select({ id: inquiries.id, reference: inquiries.reference, status: inquiries.status, notes: inquiries.notes })
    .from(inquiries)
    .where(eq(inquiries.quotationId, quotationId));
  return row ?? null;
}

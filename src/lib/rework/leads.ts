/**
 * Rework lead triggers (rework.md §2). Every send is an outbox row
 * (`kind = rework_lead`) written in the caller's transaction; the worker
 * posts it. A client stores `rework_sent_at` so one intake is not sent twice.
 */
import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { clients, outbox, quotations, user, type ClientRow, type QuotationRow } from "@/db/schema";
import { ActionError, defineAction } from "@/lib/actions";
import { withAudit } from "@/lib/audit";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import type { BodyType, Category } from "@/lib/pricing/types";
import { getSettings } from "@/lib/settings/service";
import { reworkConfigStatus } from "./endpoint";
import { mapReworkLead, type LeadFacts, type ReworkOutboxPayload } from "./payload";

/** Absolute staff URL (`APP_URL` + path) for `custom_form_submission_link`. */
export function staffUrl(path: string): string | null {
  const base = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

export function clientFacts(c: Pick<ClientRow, "fullName" | "email" | "phone" | "birthday" | "altContactName" | "altContactPhone" | "driversLicenseNo" | "companyName">): LeadFacts["client"] {
  return {
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    birthday: c.birthday,
    altContactName: c.altContactName,
    altContactPhone: c.altContactPhone,
    driversLicenseNo: c.driversLicenseNo,
    companyName: c.companyName,
  };
}

/** Map with the current settings and enqueue. Sets the client's `rework_sent_at`. */
export async function enqueueReworkLead(
  tx: DbOrTx,
  facts: LeadFacts,
  opts: {
    source: ReworkOutboxPayload["source"];
    reference: string | null;
    entity: string;
    entityId: string | null;
    clientId: string | null;
    createdBy: string | null;
  },
) {
  const s = await getSettings(tx);
  const lead = mapReworkLead(facts, { optionMap: s.rework_option_map, dateUnit: s.rework_date_unit });
  const payload: ReworkOutboxPayload = { lead, source: opts.source, reference: opts.reference };
  const row = await enqueueOutbox(tx, { kind: "rework_lead", payload, entity: opts.entity, entityId: opts.entityId, createdBy: opts.createdBy });
  if (opts.clientId) await tx.update(clients).set({ reworkSentAt: new Date() }).where(eq(clients.id, opts.clientId));
  return row;
}

async function ownerIdOf(tx: DbOrTx, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await tx.select({ reworkOwnerId: user.reworkOwnerId }).from(user).where(eq(user.id, userId));
  return u?.reworkOwnerId?.trim() || null;
}

type QuoteInputs = {
  destination?: string;
  itinerary?: string;
  pickupPlace?: string;
  dropoffPlace?: string;
  drivingTerm?: "back_and_forth" | "long_term_parking";
  rentalMethod?: string;
};

/** Facts from a quotation (staff intake) and its client. */
export async function quotationFacts(tx: DbOrTx, q: QuotationRow, client: ClientRow): Promise<LeadFacts> {
  const inputs = (q.inputs ?? {}) as QuoteInputs;
  return {
    client: clientFacts(client),
    service: q.service,
    startAt: q.startAt,
    endAt: q.endAt,
    bodyType: (q.bodyType as BodyType | null) ?? null,
    category: (q.category as Category | null) ?? null,
    destination: inputs.destination ?? null,
    itinerary: inputs.itinerary ?? null,
    pickupAddress: q.service === "with_driver" ? (inputs.pickupPlace ?? null) : null,
    dropoffAddress: q.service === "with_driver" ? (inputs.dropoffPlace ?? null) : null,
    drivingTerm: q.service === "with_driver" ? (inputs.drivingTerm ?? null) : null,
    paymentMethod: inputs.rentalMethod ?? null,
    quotationNumber: q.number,
    ownerId: await ownerIdOf(tx, q.consultantId),
    link: staffUrl(`/quotes/${q.id}`),
  };
}

/**
 * Issue hook (rework.md §2 row 2): a formal quotation issued for a client
 * added in the quotation form, when `rework_send_staff_intakes` is on and the
 * client was never sent. Runs inside the issue transaction.
 */
export async function maybeSendStaffIntake(tx: DbOrTx, quotationId: string, actorId: string): Promise<boolean> {
  const s = await getSettings(tx);
  if (!s.rework_send_staff_intakes) return false;
  const [q] = await tx.select().from(quotations).where(eq(quotations.id, quotationId));
  if (!q?.clientId) return false;
  const [client] = await tx.select().from(clients).where(eq(clients.id, q.clientId)).for("update");
  if (!client || client.source !== "quote_form" || client.reworkSentAt) return false;
  await enqueueReworkLead(tx, await quotationFacts(tx, q, client), {
    source: "quotation",
    reference: q.number,
    entity: "quotation",
    entityId: q.id,
    clientId: client.id,
    createdBy: actorId,
  });
  return true;
}

/** Manual "Send to Rework" on a client (Sales+). Already sent → 409 unless `again`. */
export const sendClientToRework = defineAction({
  permission: "rework.send",
  input: z.object({ id: z.uuid(), again: z.boolean().default(false) }),
  handler: async (actor, { id, again }) => {
    return db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
      if (!client) throw new ActionError(404, "Client not found.");
      if (client.reworkSentAt && !again) throw new ActionError(409, "This client was already sent to Rework. Use Send again to send another lead.");
      // The latest formal quotation, if any, gives the trip details.
      const [q] = await tx
        .select()
        .from(quotations)
        .where(and(eq(quotations.clientId, id), eq(quotations.kind, "formal"), ne(quotations.status, "draft")))
        .orderBy(desc(quotations.createdAt))
        .limit(1);
      const facts: LeadFacts = q
        ? await quotationFacts(tx, q, client)
        : { client: clientFacts(client), service: null, startAt: null, endAt: null, bodyType: null, category: null, link: staffUrl(`/clients/${id}`) };
      if (!q) facts.ownerId = await ownerIdOf(tx, actor.id);
      const row = await enqueueReworkLead(tx, facts, { source: "client", reference: q?.number ?? null, entity: "client", entityId: id, clientId: id, createdBy: actor.id });
      await withAudit(actor, "client.rework_send", "client", id, { reworkSentAt: client.reworkSentAt?.toISOString() ?? null }, { outboxId: row.id }, tx);
      return { outboxId: row.id };
    });
  },
});

/** Settings → "Send test lead" (Super Admin). Invented data, sent through the outbox like any lead. */
export const sendTestLead = defineAction({
  permission: "settings.edit",
  input: z.object({}),
  handler: async (actor) => {
    return db.transaction(async (tx) => {
      const now = new Date();
      const start = new Date(now.getTime() + 7 * 86_400_000);
      const facts: LeadFacts = {
        client: {
          fullName: `TEST LEAD – J-MaVe Booking ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
          email: "test-lead@example.com",
          phone: "+639170000000",
          birthday: "1990-01-01",
          altContactName: null,
          altContactPhone: null,
          driversLicenseNo: null,
          companyName: null,
        },
        service: "self_drive",
        startAt: start,
        endAt: new Date(start.getTime() + 86_400_000),
        bodyType: "sedan",
        category: "primo",
        destination: "Test only – please delete",
        specialRequests: "System test lead from J-MaVe Booking settings. Safe to delete.",
        paymentMethod: "cash",
        dealSource: "website_booking_page",
        extraLabels: ["Test"],
        ownerId: await ownerIdOf(tx, actor.id),
        link: staffUrl("/settings"),
      };
      const row = await enqueueReworkLead(tx, facts, { source: "test", reference: "Test lead", entity: "rework_test", entityId: null, clientId: null, createdBy: actor.id });
      await withAudit(actor, "rework.test_lead", "settings", "rework", null, { outboxId: row.id }, tx);
      return { outboxId: row.id };
    });
  },
});

export type ReworkDelivery = {
  id: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  source: string | null;
  reference: string | null;
  name: string | null;
  httpStatus: number | null;
  lastError: string | null;
  entity: string | null;
  entityId: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

/** Last deliveries for the settings page (newest first). */
export async function listReworkDeliveries(limit = 50, executor: DbOrTx = db): Promise<ReworkDelivery[]> {
  const rows = await executor
    .select()
    .from(outbox)
    .where(eq(outbox.kind, "rework_lead"))
    .orderBy(desc(outbox.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Partial<ReworkOutboxPayload>;
    const resp = (r.response ?? null) as { status?: number } | null;
    return {
      id: r.id,
      status: r.status,
      attempts: r.attempts,
      source: p.source ?? null,
      reference: p.reference ?? null,
      name: typeof p.lead?.name === "string" ? p.lead.name : null,
      httpStatus: typeof resp?.status === "number" ? resp.status : null,
      lastError: r.lastError,
      entity: r.entity,
      entityId: r.entityId,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
    };
  });
}

/** "URL set / Token set: yes/no" (never the values). */
export function reworkStatus() {
  const s = reworkConfigStatus(process.env);
  return { urlSet: s.urlSet, tokenSet: s.tokenSet, ready: s.ready };
}

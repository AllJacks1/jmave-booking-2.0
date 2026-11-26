/**
 * Loyalty import plan (Phase 3). Runs after the history section in the same
 * commit, so quotation numbers imported in this run already have clients.
 *
 * - New card → `loyalty_accounts` (member since = earliest rental, expires
 *   +1 year, tier = latest, `imported`), linked to a client when one can be
 *   found; otherwise kept without a client (linked later on /rewards).
 * - Each row → one `import` ledger entry (points = F), keyed so re-runs add
 *   nothing. Existing cards: only missing rows are added; the tier follows
 *   the workbook when it has one; an unlinked card is linked when possible.
 * - Sequence `JMV` = highest card number (only goes up).
 */
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { clients, loyaltyAccounts, numberSequences, pointsLedger, quotations } from "@/db/schema";
import { withAudit } from "@/lib/audit";
import { cardNoValue, LOYALTY_SEQUENCE_KEY } from "@/lib/loyalty/ledger";
import { addYearsToKey, manilaDateKey, manilaToUtc } from "@/lib/time";
import type { Op } from "./plan";
import type { ImportWarning, LoyaltyCardImport, SectionSummary } from "./types";

type ClientLink = { clientId: string; via: string } | null;

/** Most common client among the card's quotation numbers, else a unique name match. */
async function resolveClient(
  tx: DbOrTx,
  card: LoyaltyCardImport,
): Promise<{ link: ClientLink; ambiguous: boolean }> {
  const numbers = [...new Set(card.rows.map((r) => r.quotationNumber).filter((n): n is string => Boolean(n)))];
  if (numbers.length) {
    const rows = await tx
      .select({ number: quotations.number, clientId: quotations.clientId })
      .from(quotations)
      .where(inArray(quotations.number, numbers));
    const tally = new Map<string, { n: number; via: string }>();
    for (const r of rows) {
      if (!r.clientId) continue;
      const t = tally.get(r.clientId) ?? { n: 0, via: r.number! };
      t.n += 1;
      tally.set(r.clientId, t);
    }
    if (tally.size) {
      const [best] = [...tally.entries()].sort((a, b) => b[1].n - a[1].n);
      return { link: { clientId: best[0], via: best[1].via }, ambiguous: tally.size > 1 };
    }
  }
  const names = [...new Set(card.rows.map((r) => r.clientName?.trim().toLowerCase()).filter((n): n is string => Boolean(n)))];
  for (const name of names) {
    const matches = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(sql`lower(${clients.fullName}) = ${name}`)
      .limit(2);
    if (matches.length === 1) return { link: { clientId: matches[0].id, via: "client name" }, ambiguous: false };
  }
  return { link: null, ambiguous: false };
}

function occurredAt(date: string | null, fallback: Date): Date {
  return date ? manilaToUtc(date, "12:00") : fallback;
}

export async function planLoyalty(
  cards: LoyaltyCardImport[],
  db: DbOrTx,
  s: SectionSummary,
  ops: Op[],
  extra: { historyNumbers: Set<string>; now: Date },
) {
  const today = manilaDateKey(extra.now);
  const [accounts, keys, [seq]] = await Promise.all([
    db.select().from(loyaltyAccounts),
    db.select({ key: pointsLedger.importKey }).from(pointsLedger).where(isNotNull(pointsLedger.importKey)),
    db.select({ lastValue: numberSequences.lastValue }).from(numberSequences).where(eq(numberSequences.key, LOYALTY_SEQUENCE_KEY)),
  ]);
  const byCard = new Map(accounts.map((a) => [a.cardNo, a]));
  const existingKeys = new Set(keys.map((k) => k.key!));
  const warnings: ImportWarning[] = [];
  const counts = { cards: 0, rows: 0, points: 0, unlinked: 0 };

  for (const card of cards) {
    const current = byCard.get(card.cardNo);
    const missing = card.rows.filter((r) => !existingKeys.has(r.importKey));
    const viaNumber = card.rows.find((r) => r.quotationNumber && extra.historyNumbers.has(r.quotationNumber))?.quotationNumber;
    const name = card.rows.find((r) => r.clientName)?.clientName ?? null;
    const label = `${card.cardNo} · ${name ?? "no client name"} · ${card.points.toLocaleString("en-PH")} points (${card.rows.length} row${card.rows.length === 1 ? "" : "s"})`;
    const tierChanges = current && card.tier !== null && current.tier !== card.tier;
    // An unlinked card counts as changed only when a client can now be found for it.
    let canLink = false;
    if (current && !current.clientId) {
      const { link } = await resolveClient(db, card);
      if (link) {
        const [other] = await db.select({ cardNo: loyaltyAccounts.cardNo }).from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, link.clientId));
        canLink = !other;
      }
    }
    const linkDetail = viaNumber ? `client via ${viaNumber}` : "client by name if one matches";

    if (!current) {
      s.counts.new += 1;
      if (s.items.length < 5000) s.items.push({ action: "new", label, detail: `New card · ${linkDetail}` });
    } else if (missing.length || tierChanges || canLink) {
      s.counts.changed += 1;
      if (s.items.length < 5000) {
        s.items.push({
          action: "changed",
          label,
          detail: [missing.length ? `${missing.length} new row(s)` : null, tierChanges ? `tier ${current.tier ?? "—"} → ${card.tier}` : null, canLink ? "link client" : null]
            .filter(Boolean)
            .join(" · "),
        });
      }
    } else {
      s.counts.unchanged += 1;
      if (s.items.length < 5000) s.items.push({ action: "unchanged", label });
    }
    if (current && !missing.length && !tierChanges && !canLink) continue;

    ops.push(async (tx, actor) => {
      const [acc] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.cardNo, card.cardNo)).for("update");
      let accountId = acc?.id;
      let clientId = acc?.clientId ?? null;
      if (!acc || !acc.clientId) {
        const { link, ambiguous } = await resolveClient(tx, card);
        if (link) {
          const [other] = await tx.select({ cardNo: loyaltyAccounts.cardNo }).from(loyaltyAccounts).where(eq(loyaltyAccounts.clientId, link.clientId));
          if (other && other.cardNo !== card.cardNo) {
            warnings.push({ section: "loyalty", level: "warning", message: `${card.cardNo}: its client already has card ${other.cardNo}; imported without a client.` });
          } else {
            clientId = link.clientId;
            if (ambiguous) warnings.push({ section: "loyalty", level: "warning", message: `${card.cardNo}: rows point to more than one client; linked to the one from ${link.via}.` });
          }
        }
      }
      if (!acc) {
        const memberSince = card.memberSince ?? today;
        const expiresAt = addYearsToKey(memberSince, 1);
        const [created] = await tx
          .insert(loyaltyAccounts)
          .values({
            cardNo: card.cardNo,
            clientId,
            memberSince,
            expiresAt,
            tier: card.tier,
            status: expiresAt < today ? "expired" : "active",
            imported: true,
            importedName: clientId ? null : name,
          })
          .returning({ id: loyaltyAccounts.id });
        accountId = created.id;
        counts.cards += 1;
      } else {
        const patch: Partial<typeof loyaltyAccounts.$inferInsert> = {};
        if (card.tier !== null && acc.tier !== card.tier) patch.tier = card.tier;
        if (!acc.clientId && clientId) {
          patch.clientId = clientId;
          patch.importedName = null;
        }
        if (acc.imported && card.memberSince && card.memberSince < acc.memberSince) patch.memberSince = card.memberSince;
        if (Object.keys(patch).length) await tx.update(loyaltyAccounts).set(patch).where(eq(loyaltyAccounts.id, acc.id));
      }
      if (!clientId) counts.unlinked += 1;
      for (const r of missing) {
        await tx
          .insert(pointsLedger)
          .values({
            accountId: accountId!,
            kind: "import",
            points: r.points,
            importKey: r.importKey,
            occurredAt: occurredAt(r.date, extra.now),
            note: [`Loyalty Log row ${r.row}`, r.dateText, r.vra, r.quotationNumber].filter(Boolean).join(" · "),
            createdBy: actor.id,
          })
          .onConflictDoNothing({ target: pointsLedger.importKey });
        counts.rows += 1;
        counts.points += r.points;
      }
    });
  }

  // Sequence JMV: only goes up.
  const max = Math.max(0, ...cards.map((c) => cardNoValue(c.cardNo) ?? 0));
  if (max > (seq?.lastValue ?? 0)) {
    s.counts.changed += 1;
    s.items.push({ action: "changed", label: `Sequence ${LOYALTY_SEQUENCE_KEY}`, changes: { lastValue: [seq?.lastValue ?? null, max] } });
    ops.push(async (tx) => {
      await tx
        .insert(numberSequences)
        .values({ key: LOYALTY_SEQUENCE_KEY, lastValue: max })
        .onConflictDoUpdate({ target: numberSequences.key, set: { lastValue: sql`greatest(${numberSequences.lastValue}, ${max})`, updatedAt: sql`now()` } });
    });
  }

  if (cards.length) {
    ops.push(async (tx, actor) => {
      await withAudit(actor, "import.loyalty", "loyalty_account", null, null, { ...counts }, tx);
      // Warnings found while committing are kept on the summary by the caller.
      s.warnings.push(...warnings);
    });
  }
}

// One-off migration: computes event_hash/prev_hash for custody_events rows
// written before the protocol layer existed. Chain order is occurred_at ASC
// per unit. Safe to re-run — it always recomputes from scratch in order, so
// it's idempotent.
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, custodyEvents } from "@/lib/schema";
import { hashEvent } from "@/lib/domain/hash";

async function main() {
  const units = await db.select({ id: bloodUnits.id }).from(bloodUnits);
  let updated = 0;

  for (const unit of units) {
    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.unitId, unit.id))
      .orderBy(asc(custodyEvents.occurredAt));

    let prevHash: string | null = null;
    for (const e of events) {
      const eventHash = hashEvent(prevHash, {
        unitId: e.unitId,
        eventType: e.eventType,
        fromFacilityId: e.fromFacilityId,
        toFacilityId: e.toFacilityId,
        occurredAt: e.occurredAt,
      });
      await db
        .update(custodyEvents)
        .set({ prevHash, eventHash })
        .where(eq(custodyEvents.id, e.id));
      prevHash = eventHash;
      updated++;
    }
  }

  console.log(`backfill: ${updated} events updated across ${units.length} units`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

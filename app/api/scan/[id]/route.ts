import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, custodyEvents, facilities } from "@/lib/schema";
import { buaFor, verifyChain } from "@/lib/domain/protocol";

// Public provenance endpoint for the QR code printed on a unit's label —
// no Clerk session, no device key. Deliberately excludes donorRef and raw
// telemetry: this is a public-facing chain-of-custody view, not the
// operator's internal unit detail (see /api/units/[id] for that).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [unit] = await db.select().from(bloodUnits).where(eq(bloodUnits.id, id)).limit(1);
  if (!unit) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const [currentFacility] = await db
    .select({ code: facilities.code, name: facilities.name, city: facilities.city })
    .from(facilities)
    .where(eq(facilities.id, unit.currentFacilityId))
    .limit(1);

  const events = await db
    .select({
      id: custodyEvents.id,
      eventType: custodyEvents.eventType,
      occurredAt: custodyEvents.occurredAt,
      fromFacilityId: custodyEvents.fromFacilityId,
      toFacilityId: custodyEvents.toFacilityId,
    })
    .from(custodyEvents)
    .where(eq(custodyEvents.unitId, id))
    .orderBy(desc(custodyEvents.occurredAt));

  const allFacilities = await db.select().from(facilities);
  const facilityNameById = new Map(allFacilities.map((f) => [f.id, f.name]));

  const { valid: integrityValid } = await db.transaction((tx) => verifyChain(tx, id));

  return NextResponse.json({
    bua: currentFacility ? buaFor(unit, currentFacility) : null,
    rfidUid: unit.rfidUid,
    bloodGroup: unit.bloodGroup,
    component: unit.component,
    status: unit.status,
    collectedAt: unit.collectedAt,
    currentFacility: currentFacility ?? null,
    integrityValid,
    custodyEvents: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      fromFacilityName: e.fromFacilityId ? facilityNameById.get(e.fromFacilityId) ?? null : null,
      toFacilityName: e.toFacilityId ? facilityNameById.get(e.toFacilityId) ?? null : null,
    })),
  });
}

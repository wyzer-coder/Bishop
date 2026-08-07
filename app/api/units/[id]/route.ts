import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bloodUnits,
  custodyEvents,
  devices,
  facilities,
  telemetry,
} from "@/lib/schema";

// ARCHITECTURE.md section 9: unit with custody timeline and telemetry series.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [unit] = await db
    .select()
    .from(bloodUnits)
    .where(eq(bloodUnits.id, id))
    .limit(1);
  if (!unit) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const [currentFacility, originFacility] = await Promise.all([
    db.select().from(facilities).where(eq(facilities.id, unit.currentFacilityId)).limit(1),
    db.select().from(facilities).where(eq(facilities.id, unit.originFacilityId)).limit(1),
  ]);

  const events = await db
    .select({
      id: custodyEvents.id,
      eventType: custodyEvents.eventType,
      occurredAt: custodyEvents.occurredAt,
      deviceLabel: devices.label,
      meta: custodyEvents.meta,
      fromFacilityId: custodyEvents.fromFacilityId,
      toFacilityId: custodyEvents.toFacilityId,
    })
    .from(custodyEvents)
    .leftJoin(devices, eq(devices.id, custodyEvents.deviceId))
    .where(eq(custodyEvents.unitId, id))
    .orderBy(desc(custodyEvents.occurredAt));

  // Resolve from/to facility names via a lookup map rather than two joins —
  // cheap given there are only 5 facilities total.
  const allFacilities = await db.select().from(facilities);
  const facilityNameById = new Map(allFacilities.map((f) => [f.id, f.name]));

  const timeline = events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    fromFacilityName: e.fromFacilityId ? facilityNameById.get(e.fromFacilityId) ?? null : null,
    toFacilityName: e.toFacilityId ? facilityNameById.get(e.toFacilityId) ?? null : null,
    deviceLabel: e.deviceLabel,
    meta: e.meta,
  }));

  // Telemetry from the fridge device(s) at the unit's current facility —
  // ambient cold-chain context for wherever this unit physically sits.
  const fridgeDevices = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.facilityId, unit.currentFacilityId));
  const fridgeIds = fridgeDevices.map((d) => d.id);

  const readings =
    fridgeIds.length > 0
      ? await db
          .select({
            recordedAt: telemetry.recordedAt,
            tempC: telemetry.tempC,
            isBreach: telemetry.isBreach,
          })
          .from(telemetry)
          .where(inArray(telemetry.deviceId, fridgeIds))
          .orderBy(asc(telemetry.recordedAt))
          .limit(200)
      : [];

  return NextResponse.json({
    unit: {
      id: unit.id,
      rfidUid: unit.rfidUid,
      donorRef: unit.donorRef,
      bloodGroup: unit.bloodGroup,
      component: unit.component,
      status: unit.status,
      natTested: unit.natTested,
      collectedAt: unit.collectedAt,
      quarantineReason: unit.quarantineReason,
      currentFacility: currentFacility[0] ?? null,
      originFacility: originFacility[0] ?? null,
    },
    custodyEvents: timeline,
    telemetry: readings,
  });
}

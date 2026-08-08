import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDeviceByKey } from "@/lib/devices";
import { bloodUnits, custodyEvents, devices, facilities, billingLines } from "@/lib/schema";
import { transitionUnit } from "@/lib/domain/units";
import { hashEvent } from "@/lib/domain/hash";

// ARCHITECTURE.md section 9: device scan ingest. Unauthenticated by Clerk
// (excluded in middleware.ts); devices authenticate with X-Device-Key.
export async function POST(req: NextRequest) {
  const deviceKey = req.headers.get("X-Device-Key");
  if (!deviceKey) {
    return NextResponse.json({ error: "MISSING_DEVICE_KEY" }, { status: 401 });
  }
  const device = await getDeviceByKey(deviceKey);
  if (!device) {
    return NextResponse.json({ error: "INVALID_DEVICE_KEY" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.rfidUid !== "string" ||
    (body.action !== "IN" && body.action !== "OUT")
  ) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const { rfidUid, action } = body as { rfidUid: string; action: "IN" | "OUT" };

  await db
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.id, device.id));

  const [unit] = await db
    .select()
    .from(bloodUnits)
    .where(eq(bloodUnits.rfidUid, rfidUid))
    .limit(1);
  if (!unit) {
    return NextResponse.json({ error: "UNKNOWN_TAG" }, { status: 404 });
  }

  const eventType = action === "IN" ? ("SCANNED_IN" as const) : ("SCANNED_OUT" as const);

  // Idempotent-tolerant: a duplicate scan of the same unit+device+action
  // within 5 seconds (loose breadboard wiring) is ignored, not an error.
  const fiveSecondsAgo = new Date(Date.now() - 5000);
  const [dup] = await db
    .select({ id: custodyEvents.id })
    .from(custodyEvents)
    .where(
      and(
        eq(custodyEvents.unitId, unit.id),
        eq(custodyEvents.deviceId, device.id),
        eq(custodyEvents.eventType, eventType),
        gte(custodyEvents.occurredAt, fiveSecondsAgo),
      ),
    )
    .limit(1);
  if (dup) {
    return NextResponse.json({
      unit: { id: unit.id, rfidUid: unit.rfidUid, status: unit.status },
      duplicate: true,
    });
  }

  const result = await db.transaction(async (tx) => {
    // A unit dispatched (scanned OUT) while RESERVED begins its transit.
    if (action === "OUT" && unit.status === "RESERVED") {
      return transitionUnit(tx, unit.id, "IN_TRANSIT", {
        eventType: "SCANNED_OUT",
        toFacilityId: unit.currentFacilityId,
        deviceId: device.id,
      });
    }

    // A unit arriving (scanned IN) while IN_TRANSIT is issued to the
    // receiving facility's stock.
    if (action === "IN" && unit.status === "IN_TRANSIT") {
      const updated = await transitionUnit(tx, unit.id, "ISSUED", {
        eventType: "SCANNED_IN",
        toFacilityId: device.facilityId,
        deviceId: device.id,
      });

      const [facility] = await tx
        .select()
        .from(facilities)
        .where(eq(facilities.id, device.facilityId))
        .limit(1);
      if (facility?.type === "SPOKE") {
        await tx.insert(billingLines).values({
          facilityId: device.facilityId,
          unitId: unit.id,
          code: "COLD_CHAIN_STORAGE",
          description: `Cold-chain storage — ${unit.rfidUid}`,
          amountPaise: 25_000,
        });
      }
      return updated;
    }

    // No status transition applies (e.g. a routine internal scan) — still
    // record the custody event (CLAUDE.md section 2, rule 7: no exceptions),
    // and for IN, track the unit's physical relocation without touching
    // status, which stays outside transitionUnit's remit. This bypasses
    // transitionUnit, so the hash chain is computed here instead.
    const toFacilityId = action === "IN" ? device.facilityId : unit.currentFacilityId;
    const [latest] = await tx
      .select({ eventHash: custodyEvents.eventHash })
      .from(custodyEvents)
      .where(eq(custodyEvents.unitId, unit.id))
      .orderBy(desc(custodyEvents.occurredAt))
      .limit(1);
    const prevHash = latest?.eventHash ?? null;
    const occurredAt = new Date();
    await tx.insert(custodyEvents).values({
      unitId: unit.id,
      eventType,
      fromFacilityId: unit.currentFacilityId,
      toFacilityId,
      deviceId: device.id,
      occurredAt,
      prevHash,
      eventHash: hashEvent(prevHash, {
        unitId: unit.id,
        eventType,
        fromFacilityId: unit.currentFacilityId,
        toFacilityId,
        occurredAt,
      }),
    });
    if (action === "IN" && device.facilityId !== unit.currentFacilityId) {
      const [updated] = await tx
        .update(bloodUnits)
        .set({ currentFacilityId: device.facilityId, updatedAt: new Date() })
        .where(eq(bloodUnits.id, unit.id))
        .returning();
      return updated;
    }
    return unit;
  });

  return NextResponse.json({
    unit: {
      id: result.id,
      rfidUid: result.rfidUid,
      status: result.status,
      currentFacilityId: result.currentFacilityId,
    },
  });
}

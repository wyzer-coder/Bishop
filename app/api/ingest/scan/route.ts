import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDeviceByKey } from "@/lib/devices";
import { bloodUnits, devices, scanEvents } from "@/lib/schema";
import {
  getScannerFacilityId,
  planAutoScan,
  moveOut,
  moveIn,
  InvalidTransitionError,
} from "@/lib/domain/scanner";
import { findDonorByRfid, recordReturningDonation } from "@/lib/domain/donor-credits";

// ARCHITECTURE.md section 9 + the movable-scanner extension: device scan
// ingest. Unauthenticated by Clerk (excluded in middleware.ts); devices
// authenticate with X-Device-Key. Every tap writes a scan_events row,
// including unknown tags and no-op scans — that row is what the
// ScanWatcher polls in the browser.
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
  if (!body || typeof body.rfidUid !== "string") {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const rfidUid: string = body.rfidUid;
  const action: "IN" | "OUT" | "AUTO" =
    body.action === "IN" || body.action === "OUT" ? body.action : "AUTO";

  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));

  const outcome = await db.transaction(async (tx) => {
    const scannerFacilityId = await getScannerFacilityId(tx);

    // Idempotent-tolerant: a duplicate tap of the same tag on the same
    // device within 5 seconds (loose breadboard wiring, or a card held on
    // the reader) is ignored, not reprocessed — checked before we even
    // know yet whether this tag is a unit, a donor, or unknown.
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [recentDup] = await tx
      .select({ id: scanEvents.id, unitId: scanEvents.unitId })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.rfidUid, rfidUid),
          eq(scanEvents.deviceId, device.id),
          gte(scanEvents.createdAt, fiveSecondsAgo),
        ),
      )
      .orderBy(desc(scanEvents.createdAt))
      .limit(1);
    if (recentDup) {
      await tx.insert(scanEvents).values({
        rfidUid,
        deviceId: device.id,
        facilityId: scannerFacilityId,
        outcome: "DUPLICATE_IGNORED",
        unitId: recentDup.unitId,
        handled: true,
      });
      return { status: 200 as const, body: { outcome: "DUPLICATE_IGNORED" } };
    }

    const [unit] = await tx
      .select()
      .from(bloodUnits)
      .where(eq(bloodUnits.rfidUid, rfidUid))
      .limit(1);

    if (!unit) {
      // Not a blood unit tag — a recognized donor card tapped again is
      // another donation, credited immediately, no dialog needed.
      const donor = await findDonorByRfid(tx, rfidUid);
      if (donor) {
        const { balance } = await recordReturningDonation(tx, donor);
        const detail = `Thank you ${donor.name} for donating blood! You now have ${balance} credit${balance === 1 ? "" : "s"}.`;
        const [scanRow] = await tx
          .insert(scanEvents)
          .values({
            rfidUid,
            deviceId: device.id,
            facilityId: scannerFacilityId,
            outcome: "DONOR_THANKS",
            unitId: null,
            detail,
            handled: false,
          })
          .returning();
        return {
          status: 200 as const,
          body: { outcome: "DONOR_THANKS", detail, scanId: scanRow.id, donor: { id: donor.id, name: donor.name, balance } },
        };
      }

      await tx.insert(scanEvents).values({
        rfidUid,
        deviceId: device.id,
        facilityId: scannerFacilityId,
        outcome: "UNKNOWN_TAG",
        unitId: null,
        handled: false,
      });
      return { status: 404 as const, body: { error: "UNKNOWN_TAG", rfidUid } };
    }

    let resultOutcome: "MOVED_OUT" | "MOVED_IN" | "NO_CHANGE";
    let detail: string | null = null;
    let finalUnit = unit;

    if (action === "AUTO") {
      const plan = planAutoScan(unit, scannerFacilityId);
      if (plan.action === "MOVE_OUT") {
        finalUnit = await moveOut(tx, unit, device.id);
        resultOutcome = "MOVED_OUT";
      } else if (plan.action === "MOVE_IN") {
        finalUnit = await moveIn(tx, unit, device.id, scannerFacilityId);
        resultOutcome = "MOVED_IN";
      } else {
        resultOutcome = "NO_CHANGE";
        detail = plan.detail;
      }
    } else if (action === "OUT") {
      try {
        finalUnit = await moveOut(tx, unit, device.id);
        resultOutcome = "MOVED_OUT";
      } catch (err) {
        if (!(err instanceof InvalidTransitionError)) throw err;
        resultOutcome = "NO_CHANGE";
        detail = err.message;
      }
    } else {
      try {
        finalUnit = await moveIn(tx, unit, device.id, scannerFacilityId);
        resultOutcome = "MOVED_IN";
      } catch (err) {
        if (!(err instanceof InvalidTransitionError)) throw err;
        resultOutcome = "NO_CHANGE";
        detail = err.message;
      }
    }

    const [scanRow] = await tx
      .insert(scanEvents)
      .values({
        rfidUid,
        deviceId: device.id,
        facilityId: scannerFacilityId,
        outcome: resultOutcome,
        unitId: unit.id,
        detail,
        handled: false,
      })
      .returning();

    return {
      status: 200 as const,
      body: {
        outcome: resultOutcome,
        detail,
        scanId: scanRow.id,
        unit: {
          id: finalUnit.id,
          rfidUid: finalUnit.rfidUid,
          status: finalUnit.status,
          currentFacilityId: finalUnit.currentFacilityId,
        },
      },
    };
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}

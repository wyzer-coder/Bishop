// Scan-driven unit registration and the movable scanner. Additive — does
// not touch matching.ts, credits.ts, coldchain.ts or billing.ts. Every
// movement here goes through transitionUnit() (lib/domain/units.ts), so the
// state machine and custody hash chain stay the single source of truth;
// this module only decides *which* transition a tap implies and writes the
// genesis row for a brand-new unit the same way scripts/seed.ts does.
import { eq } from "drizzle-orm";
import {
  transitionUnit,
  InvalidTransitionError,
  SHELF_LIFE_DAYS,
  type Tx,
  type UnitStatus,
  type BloodGroup,
  type Component,
} from "@/lib/domain/units";
import { hashEvent } from "@/lib/domain/hash";
import { coldChainStorageLine } from "@/lib/domain/billing";
import { bloodUnits, custodyEvents, facilities, scannerState } from "@/lib/schema";

export async function getScannerFacilityId(tx: Tx): Promise<string> {
  const [row] = await tx.select().from(scannerState).where(eq(scannerState.id, 1)).limit(1);
  if (!row) {
    throw new Error("scanner_state has no row — did the seed run?");
  }
  return row.currentFacilityId;
}

// A unit sitting here, in one of these statuses, is eligible to be tapped
// OUT. Deliberately excludes COLLECTED/TESTING (not yet cleared to travel —
// forcing that would mean fabricating a NAT test result, which
// transitionUnit's own AVAILABLE guard exists specifically to prevent) and
// every terminal-ish status (TRANSFUSED, QUARANTINED, EXPIRED, DISCARDED).
const MOVABLE_AT_REST: UnitStatus[] = ["AVAILABLE", "RESERVED"];

export type ScanPlan =
  | { action: "MOVE_OUT" }
  | { action: "MOVE_IN" }
  | { action: "NONE"; detail: string };

export function planAutoScan(
  unit: { status: UnitStatus; currentFacilityId: string },
  scannerFacilityId: string,
): ScanPlan {
  const here = unit.currentFacilityId === scannerFacilityId;
  if (here) {
    if (MOVABLE_AT_REST.includes(unit.status)) {
      return { action: "MOVE_OUT" };
    }
    if (unit.status === "IN_TRANSIT") {
      return { action: "NONE", detail: "Unit is already in transit from here" };
    }
    return { action: "NONE", detail: `Unit is ${unit.status} and cannot be moved` };
  }
  if (unit.status === "IN_TRANSIT") {
    return { action: "MOVE_IN" };
  }
  return {
    action: "NONE",
    detail: `Unit is at a different facility and is ${unit.status}`,
  };
}

/**
 * Walks a unit forward to IN_TRANSIT — one hop from RESERVED, two from
 * AVAILABLE (via RESERVED) — each hop its own transitionUnit() call, so
 * each still writes its own custody event and chained hash. Never skips a
 * step in the state machine to get there faster.
 */
export async function moveOut(
  tx: Tx,
  unit: { id: string; status: UnitStatus; currentFacilityId: string },
  deviceId: string | null,
) {
  let current = unit.status;
  if (current === "AVAILABLE") {
    await transitionUnit(tx, unit.id, "RESERVED", {
      eventType: "RELEASED",
      deviceId: deviceId ?? undefined,
    });
    current = "RESERVED";
  }
  return transitionUnit(tx, unit.id, "IN_TRANSIT", {
    eventType: "SCANNED_OUT",
    deviceId: deviceId ?? undefined,
  });
}

/**
 * IN_TRANSIT -> ISSUED at the scanner's current facility. Preserves the
 * pre-existing behavior of billing a cold-chain-storage line when a unit
 * arrives at a SPOKE (lib/domain/billing.ts is called, never modified).
 */
export async function moveIn(
  tx: Tx,
  unit: { id: string },
  deviceId: string | null,
  scannerFacilityId: string,
) {
  const updated = await transitionUnit(tx, unit.id, "ISSUED", {
    eventType: "SCANNED_IN",
    toFacilityId: scannerFacilityId,
    deviceId: deviceId ?? undefined,
  });

  const [destFacility] = await tx
    .select()
    .from(facilities)
    .where(eq(facilities.id, scannerFacilityId))
    .limit(1);
  if (destFacility?.type === "SPOKE") {
    await coldChainStorageLine(tx, scannerFacilityId, updated.id, updated.rfidUid);
  }
  return updated;
}

export { InvalidTransitionError };

export type RegisterUnitInput = {
  rfidUid: string;
  bloodGroup: BloodGroup;
  component: Component;
  donorRef: string;
  collectedAt: Date;
  facilityId: string;
  deviceId?: string | null;
};

/**
 * Genesis creation for a unit that was never seeded — the scan dialog's
 * "Register unit" submit. Mirrors scripts/seed.ts's own genesis pattern
 * (direct insert + a single COLLECTED custody event with no prevHash)
 * rather than transitionUnit, which requires a row to already exist.
 * Created AVAILABLE and nat_tested — an operator entering full details by
 * hand for an already-registered unit, not a fresh raw collection — so it
 * immediately participates in risk/allocation like any other AVAILABLE
 * unit, with no separate TESTING step to walk through first.
 */
export async function registerUnit(tx: Tx, input: RegisterUnitInput) {
  const shelfLifeMs = SHELF_LIFE_DAYS[input.component] * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(input.collectedAt.getTime() + shelfLifeMs);

  const [unit] = await tx
    .insert(bloodUnits)
    .values({
      rfidUid: input.rfidUid,
      donorRef: input.donorRef,
      bloodGroup: input.bloodGroup,
      component: input.component,
      status: "AVAILABLE",
      natTested: true,
      collectedAt: input.collectedAt,
      expiresAt,
      currentFacilityId: input.facilityId,
      originFacilityId: input.facilityId,
    })
    .returning();

  const occurredAt = new Date();
  const eventHash = hashEvent(null, {
    unitId: unit.id,
    eventType: "COLLECTED",
    fromFacilityId: null,
    toFacilityId: input.facilityId,
    occurredAt,
  });
  await tx.insert(custodyEvents).values({
    unitId: unit.id,
    eventType: "COLLECTED",
    fromFacilityId: null,
    toFacilityId: input.facilityId,
    deviceId: input.deviceId ?? undefined,
    occurredAt,
    prevHash: null,
    eventHash,
  });

  return unit;
}

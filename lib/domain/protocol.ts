// ARCHITECTURE.md section 5A: the protocol layer.
import { and, asc, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/domain/units";
import {
  SHELF_LIFE_DAYS,
  remainingHours,
  type BloodGroup,
  type Component,
} from "@/lib/domain/units";
import { hashEvent } from "@/lib/domain/hash";
import { bloodUnits, custodyEvents, facilities, reserveFloors } from "@/lib/schema";

export { hashEvent, type ChainableEvent } from "@/lib/domain/hash";

export type Bua = {
  facilityCode: string;
  group: BloodGroup;
  component: Component;
  rfidUid: string;
};

export function buaFor(
  unit: { rfidUid: string; bloodGroup: BloodGroup; component: Component },
  facility: { code: string },
): string {
  return `bua:${facility.code}/${unit.bloodGroup}/${unit.component}/${unit.rfidUid}`;
}

export function parseBua(input: string): Bua | null {
  const match = /^bua:([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(input.trim());
  if (!match) return null;
  const [, facilityCode, group, component, rfidUid] = match;
  return {
    facilityCode,
    group: group as BloodGroup,
    component: component as Component,
    rfidUid,
  };
}

export async function getLatestEventHash(
  tx: Tx,
  unitId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ eventHash: custodyEvents.eventHash })
    .from(custodyEvents)
    .where(eq(custodyEvents.unitId, unitId))
    .orderBy(desc(custodyEvents.occurredAt))
    .limit(1);
  return row?.eventHash ?? null;
}

export async function verifyChain(
  tx: Tx,
  unitId: string,
): Promise<{ valid: boolean; brokenAtEventId: string | null }> {
  const events = await tx
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.unitId, unitId))
    .orderBy(asc(custodyEvents.occurredAt));

  let prevHash: string | null = null;
  for (const e of events) {
    const expected = hashEvent(prevHash, {
      unitId: e.unitId,
      eventType: e.eventType,
      fromFacilityId: e.fromFacilityId,
      toFacilityId: e.toFacilityId,
      occurredAt: e.occurredAt,
    });
    if (e.eventHash !== expected) {
      return { valid: false, brokenAtEventId: e.id };
    }
    prevHash = e.eventHash;
  }
  return { valid: true, brokenAtEventId: null };
}

/**
 * Same check as verifyChain, for every unit at once, in one query instead of
 * one round trip per unit. Used by GET /api/stats (dashboard's "unroutable"
 * count) — /api/units/[id] still uses verifyChain, which is the honest
 * per-unit primitive; this is a bulk optimization on top of the same logic,
 * not a replacement for it.
 */
export async function verifyAllChains(tx: Tx): Promise<Map<string, boolean>> {
  const events = await tx.select().from(custodyEvents).orderBy(asc(custodyEvents.occurredAt));
  const byUnit = new Map<string, typeof events>();
  for (const e of events) {
    if (!byUnit.has(e.unitId)) byUnit.set(e.unitId, []);
    byUnit.get(e.unitId)!.push(e);
  }
  const result = new Map<string, boolean>();
  for (const [unitId, unitEvents] of byUnit) {
    let prevHash: string | null = null;
    let valid = true;
    for (const e of unitEvents) {
      const expected = hashEvent(prevHash, {
        unitId: e.unitId,
        eventType: e.eventType,
        fromFacilityId: e.fromFacilityId,
        toFacilityId: e.toFacilityId,
        occurredAt: e.occurredAt,
      });
      if (e.eventHash !== expected) {
        valid = false;
        break;
      }
      prevHash = e.eventHash;
    }
    result.set(unitId, valid);
  }
  return result;
}

/**
 * Emergency-reserve partition, shared by protocol.ts (per-unit `reserved`
 * flag on resolve) and matching.ts (candidate pre-filter for allocation).
 * Freshest `floor` units stay reserved; anything past that is network
 * surplus. Freshest-first because a facility gains nothing by hoarding
 * stock that's about to expire anyway — better to export what's closest to
 * expiry and keep the newest units as the local safety margin.
 */
export function partitionReserve<T extends { remainingHours: number }>(
  units: T[],
  floor: number,
): { reserved: T[]; available: T[] } {
  const sorted = [...units].sort((a, b) => b.remainingHours - a.remainingHours);
  return { reserved: sorted.slice(0, floor), available: sorted.slice(floor) };
}

export type ResolvedUnit = {
  bua: string;
  rfidUid: string;
  group: BloodGroup;
  component: Component;
  status: string;
  heldAt: { code: string; name: string; lat: string; lng: string };
  ttlHours: number;
  ttlRatio: number;
  integrityValid: boolean;
  custodyHash: string | null;
  coldChainIntact: boolean;
  reserved: boolean;
  routable: boolean;
};

export async function resolveBua(tx: Tx, buaString: string): Promise<ResolvedUnit | null> {
  const parsed = parseBua(buaString);
  if (!parsed) return null;

  const [unit] = await tx
    .select()
    .from(bloodUnits)
    .where(eq(bloodUnits.rfidUid, parsed.rfidUid))
    .limit(1);
  if (!unit) return null;

  const [facility] = await tx
    .select()
    .from(facilities)
    .where(eq(facilities.id, unit.currentFacilityId))
    .limit(1);
  if (!facility) return null;

  const now = new Date();
  const hours = remainingHours(
    { component: unit.component, collectedAt: unit.collectedAt },
    now,
  );
  const shelfHours = SHELF_LIFE_DAYS[unit.component] * 24;
  const ttlRatio = Math.max(0, Math.min(1, hours / shelfHours));
  const { valid } = await verifyChain(tx, unit.id);
  const custodyHash = await getLatestEventHash(tx, unit.id);

  const reserved = await isUnitReserved(tx, unit);

  return {
    bua: buaFor(unit, facility),
    rfidUid: unit.rfidUid,
    group: unit.bloodGroup,
    component: unit.component,
    status: unit.status,
    heldAt: {
      code: facility.code,
      name: facility.name,
      lat: facility.lat,
      lng: facility.lng,
    },
    ttlHours: Math.max(0, hours),
    ttlRatio,
    integrityValid: valid,
    custodyHash,
    coldChainIntact: unit.quarantineReason === null,
    reserved,
    routable: valid && unit.status === "AVAILABLE" && !reserved,
  };
}

async function isUnitReserved(
  tx: Tx,
  unit: { id: string; currentFacilityId: string; bloodGroup: BloodGroup; component: Component; status: string; collectedAt: Date },
): Promise<boolean> {
  if (unit.status !== "AVAILABLE") return false;

  // reserve_floors is keyed (facility, blood_group, component) — each pool
  // is scoped to an exact group+component, not just the facility.
  const [floorRow] = await tx
    .select({ minUnits: reserveFloors.minUnits })
    .from(reserveFloors)
    .where(
      and(
        eq(reserveFloors.facilityId, unit.currentFacilityId),
        eq(reserveFloors.bloodGroup, unit.bloodGroup),
        eq(reserveFloors.component, unit.component),
      ),
    )
    .limit(1);
  const floor = floorRow?.minUnits ?? 0;
  if (floor === 0) return false;

  const pool = await tx
    .select({
      id: bloodUnits.id,
      collectedAt: bloodUnits.collectedAt,
      component: bloodUnits.component,
    })
    .from(bloodUnits)
    .where(
      and(
        eq(bloodUnits.currentFacilityId, unit.currentFacilityId),
        eq(bloodUnits.bloodGroup, unit.bloodGroup),
        eq(bloodUnits.component, unit.component),
        eq(bloodUnits.status, "AVAILABLE"),
      ),
    );

  const now = new Date();
  const sameStock = pool.map((u) => ({
    id: u.id,
    remainingHours: remainingHours({ component: u.component, collectedAt: u.collectedAt }, now),
  }));
  const { reserved } = partitionReserve(sameStock, floor);
  return reserved.some((r) => r.id === unit.id);
}

const HAVERSINE_R_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * HAVERSINE_R_KM * Math.asin(Math.sqrt(s));
}

export function etaMinutesFor(distanceKm: number): number {
  const KMPH = 30;
  const HANDLING_MINUTES = 15;
  return (distanceKm / KMPH) * 60 + HANDLING_MINUTES;
}

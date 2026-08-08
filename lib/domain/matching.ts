// ARCHITECTURE.md section 5A: rewritten around allocation, not suggestion.
// The old section 5 four-term scoring formula (shortage/urgency/distance/
// creditNeed) is superseded here by the network-cost objective below; it
// still exists as spec-of-record for the not-yet-built /transfers
// suggestion path, but this file no longer implements it.
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/domain/units";
import {
  COMPATIBILITY,
  SHELF_LIFE_DAYS,
  remainingHours,
  type BloodGroup,
  type Component,
} from "@/lib/domain/units";
import { buaFor, haversineKm, etaMinutesFor, partitionReserve, verifyChain } from "@/lib/domain/protocol";
import { bloodUnits, facilities, reserveFloors, transfers } from "@/lib/schema";

export type Priority = "EMERGENCY" | "URGENT" | "ROUTINE";

export type AllocateRequest = {
  group: BloodGroup;
  component: Component;
  units: number;
  lat: number;
  lng: number;
  neededBy?: string;
  priority?: Priority;
};

export type AllocationResult = {
  bua: string;
  unitId: string;
  rfidUid: string;
  heldAt: { code: string; name: string; lat: string; lng: string };
  distanceKm: number;
  etaMinutes: number;
  etaBasis: string;
  ttlHours: number;
  custodyVerified: boolean;
  coldChainIntact: boolean;
  creditCost: number;
  costBreakdown: CostBreakdown;
  reason: string;
  wasReserved: boolean;
};

export type AllocationResponse = {
  results: AllocationResult[];
  replenishment?: { transferId: string; etaMinutes: number } | null;
};

// section 5A: rarityWeight = O_NEG 2.0, AB_NEG 1.8, B_NEG 1.6, A_NEG 1.4, others 1.0
const RARITY_WEIGHT: Record<BloodGroup, number> = {
  O_NEG: 2.0,
  AB_NEG: 1.8,
  B_NEG: 1.6,
  A_NEG: 1.4,
  O_POS: 1.0,
  A_POS: 1.0,
  B_POS: 1.0,
  AB_POS: 1.0,
};

/** Donor groups that can give to a recipient of `requestGroup`. */
function compatibleDonorGroups(requestGroup: BloodGroup): BloodGroup[] {
  return (Object.keys(COMPATIBILITY) as BloodGroup[]).filter((donor) =>
    COMPATIBILITY[donor].includes(requestGroup),
  );
}

type StockUnit = {
  id: string;
  rfidUid: string;
  bloodGroup: BloodGroup;
  collectedAt: Date;
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  facilityLat: string;
  facilityLng: string;
};

/**
 * All AVAILABLE units of `component`, in any group compatible with
 * `requestGroup`, network-wide — already split into reserved vs. network
 * surplus per facility+group (ARCHITECTURE.md section 5A: reserved units
 * are a pre-filter, removed before scoring, never a penalty term).
 */
async function availableForNetwork(tx: Tx, requestGroup: BloodGroup, component: Component) {
  const donorGroups = compatibleDonorGroups(requestGroup);

  const units = await tx
    .select({
      id: bloodUnits.id,
      rfidUid: bloodUnits.rfidUid,
      bloodGroup: bloodUnits.bloodGroup,
      collectedAt: bloodUnits.collectedAt,
      facilityId: bloodUnits.currentFacilityId,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      facilityLat: facilities.lat,
      facilityLng: facilities.lng,
    })
    .from(bloodUnits)
    .innerJoin(facilities, eq(facilities.id, bloodUnits.currentFacilityId))
    .where(and(eq(bloodUnits.component, component), eq(bloodUnits.status, "AVAILABLE")));

  const compatible = units.filter((u) => donorGroups.includes(u.bloodGroup)) as StockUnit[];

  const floorRows = await tx
    .select()
    .from(reserveFloors)
    .where(eq(reserveFloors.component, component));
  const floorByKey = new Map(
    floorRows
      .filter((f) => donorGroups.includes(f.bloodGroup))
      .map((f) => [`${f.facilityId}:${f.bloodGroup}`, f.minUnits]),
  );

  const now = new Date();
  const byGroupFacility = new Map<string, (StockUnit & { remainingHours: number })[]>();
  for (const u of compatible) {
    const key = `${u.facilityId}:${u.bloodGroup}`;
    const withHours = { ...u, remainingHours: remainingHours({ component, collectedAt: u.collectedAt }, now) };
    if (!byGroupFacility.has(key)) byGroupFacility.set(key, []);
    byGroupFacility.get(key)!.push(withHours);
  }

  const available: (StockUnit & { remainingHours: number })[] = [];
  const reservedIds = new Set<string>();
  for (const [key, group] of byGroupFacility) {
    const floor = floorByKey.get(key) ?? 0;
    const { reserved, available: surplus } = partitionReserve(group, floor);
    for (const r of reserved) reservedIds.add(r.id);
    available.push(...surplus);
  }

  // "Last compatible unit at its facility" (section 5A): count of
  // network-available compatible units sharing each facility.
  const countByFacility = new Map<string, number>();
  for (const u of available) {
    countByFacility.set(u.facilityId, (countByFacility.get(u.facilityId) ?? 0) + 1);
  }

  return { available, reservedIds, countByFacility };
}

export type CostBreakdown = {
  distance: number;
  substitution: number;
  lastUnit: number;
  ttlSalvage: number;
};

type CostParams = {
  unit: { bloodGroup: BloodGroup; remainingHours: number; facilityId: string };
  request: { group: BloodGroup; component: Component; lat: number; lng: number };
  facility: { lat: number; lng: number };
  lastCompatibleAtFacility: boolean;
};

export function costBreakdown(params: CostParams): CostBreakdown {
  const { unit, request, facility, lastCompatibleAtFacility } = params;
  const distanceKm = haversineKm(request, facility);
  const shelfHours = SHELF_LIFE_DAYS[request.component] * 24;
  const ttlRatio = Math.max(0, Math.min(1, unit.remainingHours / shelfHours));

  return {
    distance: 0.5 * distanceKm,
    substitution: unit.bloodGroup !== request.group ? 25 * RARITY_WEIGHT[unit.bloodGroup] : 0,
    lastUnit: lastCompatibleAtFacility ? 30 : 0,
    ttlSalvage: -100 * (1 - ttlRatio),
  };
}

export function cost(params: CostParams): number {
  const b = costBreakdown(params);
  return b.distance + b.substitution + b.lastUnit + b.ttlSalvage;
}

function formatTtl(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function groupLabel(g: BloodGroup): string {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

type Candidate = StockUnit & {
  remainingHours: number;
  distanceKm: number;
  cost: number;
  breakdown: CostBreakdown;
};

function rankCandidates(
  stock: (StockUnit & { remainingHours: number })[],
  countByFacility: Map<string, number>,
  request: AllocateRequest,
): Candidate[] {
  return stock
    .map((u) => {
      const distanceKm = haversineKm(request, { lat: Number(u.facilityLat), lng: Number(u.facilityLng) });
      const lastAtFacility = (countByFacility.get(u.facilityId) ?? 0) === 1;
      const breakdown = costBreakdown({
        unit: { bloodGroup: u.bloodGroup, remainingHours: u.remainingHours, facilityId: u.facilityId },
        request,
        facility: { lat: Number(u.facilityLat), lng: Number(u.facilityLng) },
        lastCompatibleAtFacility: lastAtFacility,
      });
      const c = breakdown.distance + breakdown.substitution + breakdown.lastUnit + breakdown.ttlSalvage;
      return { ...u, distanceKm, cost: c, breakdown };
    })
    .sort((a, b) => a.cost - b.cost);
}

async function toResult(
  tx: Tx,
  candidate: Candidate,
  request: AllocateRequest,
  bestExactMatch: Candidate | null,
  etaOverride?: number,
): Promise<AllocationResult> {
  const { valid } = await verifyChain(tx, candidate.id);
  const distanceKm = candidate.distanceKm;
  const etaMinutes = etaOverride ?? etaMinutesFor(distanceKm);

  let reason: string;
  if (candidate.bloodGroup === request.group) {
    reason = `Exact ${groupLabel(candidate.bloodGroup)} match, ${candidate.facilityName}, ${distanceKm.toFixed(1)} km away, ${formatTtl(candidate.remainingHours)} remaining.`;
  } else if (bestExactMatch && bestExactMatch.id !== candidate.id) {
    reason =
      `Exact ${groupLabel(request.group)} match available ${bestExactMatch.distanceKm.toFixed(1)} km away with ${formatTtl(bestExactMatch.remainingHours)} remaining. ` +
      `Allocating ${groupLabel(candidate.bloodGroup)} from ${candidate.facilityName} instead: ${formatTtl(candidate.remainingHours)} remaining, would otherwise expire. Net network wastage avoided: 1 unit.`;
  } else {
    reason = `Compatible ${groupLabel(candidate.bloodGroup)} substitute from ${candidate.facilityName}, ${distanceKm.toFixed(1)} km away, ${formatTtl(candidate.remainingHours)} remaining. No exact ${groupLabel(request.group)} match available network-wide.`;
  }

  return {
    bua: buaFor({ ...candidate, component: request.component }, { code: candidate.facilityCode }),
    unitId: candidate.id,
    rfidUid: candidate.rfidUid,
    heldAt: {
      code: candidate.facilityCode,
      name: candidate.facilityName,
      lat: candidate.facilityLat,
      lng: candidate.facilityLng,
    },
    distanceKm: Math.round(distanceKm * 10) / 10,
    etaMinutes: Math.round(etaMinutes),
    etaBasis: "distanceKm / 30 kmph * 60 + 15 min handling",
    ttlHours: Math.round(candidate.remainingHours * 10) / 10,
    custodyVerified: valid,
    coldChainIntact: true,
    creditCost: Math.round(candidate.cost * 100) / 100,
    costBreakdown: candidate.breakdown,
    reason,
    wasReserved: false,
  };
}

async function nearestFacility(tx: Tx, point: { lat: number; lng: number }) {
  const all = await tx.select().from(facilities);
  let best = all[0];
  let bestDist = Infinity;
  for (const f of all) {
    const d = haversineKm(point, { lat: Number(f.lat), lng: Number(f.lng) });
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return { facility: best, distanceKm: bestDist };
}

export async function allocate(tx: Tx, request: AllocateRequest): Promise<AllocationResponse> {
  const priority = request.priority ?? "ROUTINE";
  const { available, countByFacility } = await availableForNetwork(tx, request.group, request.component);
  const ranked = rankCandidates(available, countByFacility, request);
  const bestExactMatch = ranked.find((c) => c.bloodGroup === request.group) ?? null;

  if (priority === "EMERGENCY") {
    return allocateEmergency(tx, request);
  }
  if (priority === "URGENT") {
    return allocateUrgent(tx, request, ranked, bestExactMatch);
  }

  // ROUTINE: full network optimisation, argmin cost, no distance cutoff.
  const chosen = ranked.slice(0, request.units);
  const results = await Promise.all(chosen.map((c) => toResult(tx, c, request, bestExactMatch)));
  return { results };
}

async function allocateUrgent(
  tx: Tx,
  request: AllocateRequest,
  ranked: Candidate[],
  bestExactMatch: Candidate | null,
): Promise<AllocationResponse> {
  const { facility: local } = await nearestFacility(tx, request);
  const localFirst = ranked.filter((c) => c.facilityId === local.id);
  const withinHour = ranked.filter((c) => etaMinutesFor(c.distanceKm) <= 60);

  const chosen: Candidate[] = [];
  for (const c of localFirst) {
    if (chosen.length >= request.units) break;
    chosen.push(c);
  }
  for (const c of withinHour) {
    if (chosen.length >= request.units) break;
    if (!chosen.some((x) => x.id === c.id)) chosen.push(c);
  }

  const results = await Promise.all(chosen.map((c) => toResult(tx, c, request, bestExactMatch)));
  return { results };
}

async function allocateEmergency(
  tx: Tx,
  request: AllocateRequest,
): Promise<AllocationResponse> {
  const { facility: local } = await nearestFacility(tx, request);

  // Local reserve only: draw from the units the network-availability
  // pre-filter set aside for this exact facility+group+component.
  const donorGroups = compatibleDonorGroups(request.group).sort((a, b) =>
    a === request.group ? -1 : b === request.group ? 1 : 0,
  );

  const reserveUnits = await tx
    .select({
      id: bloodUnits.id,
      rfidUid: bloodUnits.rfidUid,
      bloodGroup: bloodUnits.bloodGroup,
      collectedAt: bloodUnits.collectedAt,
    })
    .from(bloodUnits)
    .where(
      and(
        eq(bloodUnits.currentFacilityId, local.id),
        eq(bloodUnits.component, request.component),
        eq(bloodUnits.status, "AVAILABLE"),
        inArray(bloodUnits.bloodGroup, donorGroups.length ? donorGroups : ["O_NEG"]),
      ),
    );
  const now = new Date();
  const localStock = reserveUnits.map((u) => ({
    ...u,
    remainingHours: remainingHours({ component: request.component, collectedAt: u.collectedAt }, now),
  }));

  const floorRows = await tx
    .select()
    .from(reserveFloors)
    .where(eq(reserveFloors.facilityId, local.id));

  const chosen: { id: string; rfidUid: string; bloodGroup: BloodGroup; remainingHours: number }[] = [];
  for (const group of donorGroups) {
    if (chosen.length >= request.units) break;
    const floor = floorRows.find((f) => f.bloodGroup === group && f.component === request.component)?.minUnits ?? 0;
    if (floor === 0) continue;
    const pool = localStock.filter((u) => u.bloodGroup === group);
    const { reserved } = partitionReserve(pool, floor);
    for (const r of reserved) {
      if (chosen.length >= request.units) break;
      chosen.push(r);
    }
  }

  const results = await Promise.all(
    chosen.map(async (u) => {
      const { valid } = await verifyChain(tx, u.id);
      const reason = `Emergency draw from ${local.name}'s reserve floor: ${groupLabel(u.bloodGroup)} on-site, ${formatTtl(u.remainingHours)} remaining. Local reserve bypasses routing.`;
      return {
        bua: buaFor({ rfidUid: u.rfidUid, bloodGroup: u.bloodGroup, component: request.component }, { code: local.code }),
        unitId: u.id,
        rfidUid: u.rfidUid,
        heldAt: { code: local.code, name: local.name, lat: local.lat, lng: local.lng },
        distanceKm: 0,
        etaMinutes: 0,
        etaBasis: "local reserve on-site, no transit",
        ttlHours: Math.round(u.remainingHours * 10) / 10,
        custodyVerified: valid,
        coldChainIntact: true,
        creditCost: 0,
        costBreakdown: { distance: 0, substitution: 0, lastUnit: 0, ttlSalvage: 0 },
        reason,
        wasReserved: true,
      } satisfies AllocationResult;
    }),
  );

  // Auto-replenishment: a REQUESTED transfer from the nearest HUB, using an
  // actual network-available compatible unit there if one exists.
  let replenishment: AllocationResponse["replenishment"] = null;
  if (results.length > 0) {
    const [hub] = await tx.select().from(facilities).where(eq(facilities.type, "HUB")).limit(1);
    if (hub) {
      const { available: hubAvailable } = await availableForNetwork(tx, request.group, request.component);
      const atHub = hubAvailable.filter((u) => u.facilityId === hub.id).sort((a, b) => b.remainingHours - a.remainingHours)[0];
      if (atHub) {
        const distanceKm = haversineKm({ lat: Number(hub.lat), lng: Number(hub.lng) }, { lat: Number(local.lat), lng: Number(local.lng) });
        const replenishmentEtaMinutes = Math.round(etaMinutesFor(distanceKm));
        const [transferRow] = await tx
          .insert(transfers)
          .values({
            unitId: atHub.id,
            offeringFacilityId: hub.id,
            receivingFacilityId: local.id,
            status: "REQUESTED",
            credits: 1,
            reason: `Automatic replenishment after emergency draw on ${local.name}'s reserve floor.`,
            score: "0",
          })
          .returning({ id: transfers.id });
        replenishment = { transferId: transferRow.id, etaMinutes: replenishmentEtaMinutes };
      }
    }
  }

  return { results, replenishment };
}

// ARCHITECTURE.md section 11 (Phase 5B re-theme): deterministic seed,
// truncate-then-insert, re-runnable. `pnpm seed` must print identical
// *structure* every run (same facility roles, same group/component/status
// mix, same engineered at-risk/substitution units) — see the note on `now`
// below for the one deliberate exception.
//
// Facility data is real: loaded from the data.gov.in Blood Bank Directory
// (live, if DATA_GOV_IN_KEY is set and the API responds) or from the
// committed offline snapshot otherwise. See lib/data/govdata.ts — that
// fetch happens ONLY here, never in a request path.
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import {
  facilities,
  devices,
  bloodUnits,
  custodyEvents,
  creditLedger,
  demandSignals,
  slaContracts,
  billingLines,
  reserveFloors,
  scannerState,
} from "@/lib/schema";
import { hashEvent } from "@/lib/domain/hash";
import { haversineKm } from "@/lib/domain/protocol";
import { loadRealFacilities, type GovFacility } from "@/lib/data/govdata";
import { fetchAmbientC } from "@/lib/data/openmeteo";

// Deterministic PRNG (mulberry32). Every *structural* choice in this seed
// (which facility/group/component/status a unit gets, demand jitter, billing
// line day offsets) is driven by this, seeded with a fixed constant — so two
// runs produce the same shape. Only the at-risk units' collected_at values are
// computed relative to `now` at run time, on purpose: ARCHITECTURE.md section
// 11 wants ~8 units inside their risk window "at demo time", which only holds
// if their age is relative to when you run the seed, not a fixed past date.
function mulberry32(seed: number) {
  let s = seed;
  return function rng() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260101);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pool<T>(counts: [T, number][]): T[] {
  const out: T[] = [];
  for (const [value, count] of counts) {
    for (let i = 0; i < count; i++) out.push(value);
  }
  return out;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR);
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

// Moves to lib/domain/units.ts in Phase 3 as the canonical source.
const SHELF_LIFE_HOURS = {
  WHOLE: 35 * 24,
  PRBC: 42 * 24,
  PLATELET: 5 * 24,
  PLASMA: 365 * 24,
} as const;

type Component = keyof typeof SHELF_LIFE_HOURS;
type BloodGroup =
  | "A_POS"
  | "A_NEG"
  | "B_POS"
  | "B_NEG"
  | "O_POS"
  | "O_NEG"
  | "AB_POS"
  | "AB_NEG";
type UnitStatus =
  | "COLLECTED"
  | "TESTING"
  | "AVAILABLE"
  | "RESERVED"
  | "IN_TRANSIT"
  | "ISSUED"
  | "TRANSFUSED"
  | "QUARANTINED"
  | "DISCARDED";

const NAT_TESTED_STATUSES: UnitStatus[] = [
  "AVAILABLE",
  "RESERVED",
  "IN_TRANSIT",
  "ISSUED",
  "TRANSFUSED",
  "QUARANTINED",
  "DISCARDED",
];

// Forward geodesic destination point — used once, at seed time, to compute
// a demo request point exactly N km from a real facility along whichever
// bearing lands closest to the desired distance from a second real
// facility. Kept local rather than imported from lib/domain/protocol.ts,
// which only needs haversineKm (distance), not this (a point given a
// distance and bearing).
function destination(
  start: { lat: number; lng: number },
  bearingDeg: number,
  distKm: number,
): { lat: number; lng: number } {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distKm / R) + Math.cos(lat1) * Math.sin(distKm / R) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distKm / R) * Math.cos(lat1),
      Math.cos(distKm / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** Point exactly `nearKm` from `near`, chosen along whichever bearing puts it
 * closest to `farKm` from `far`. Makes the substitution scenario below
 * self-adjusting to whichever real coordinates loadRealFacilities returns
 * (live API or snapshot), rather than assuming fixed lat/lngs. */
function solveDemoPoint(
  near: { lat: number; lng: number },
  far: { lat: number; lng: number },
  nearKm: number,
  farKm: number,
) {
  let best: { bearing: number; point: { lat: number; lng: number }; dist: number } | null = null;
  for (let b = 0; b < 360; b += 0.25) {
    const point = destination(near, b, nearKm);
    const dist = haversineKm(point, far);
    if (!best || Math.abs(dist - farKm) < Math.abs(best.dist - farKm)) {
      best = { bearing: b, point, dist };
    }
  }
  return best!;
}

async function main() {
  console.log(`seed: starting, now = ${now.toISOString()}`);

  // ─── Real facility data (data.gov.in, live or snapshot fallback) ──────
  const { facilities: realFacilities, source } = await loadRealFacilities("Jharkhand", "Dhanbad");
  console.log(`seed: facility data source = ${source} (${realFacilities.length} facilities)`);

  await db.execute(sql`
    TRUNCATE TABLE
      allocation_log, billing_lines, sla_contracts, demand_signals,
      credit_ledger, transfers, breaches, telemetry, shipment_units,
      shipments, custody_events, blood_units, reserve_floors, devices,
      users, facilities, scan_events, scanner_state
    RESTART IDENTITY CASCADE
  `);

  // ─── Facilities ─────────────────────────────────────────────────────
  const facilityRows = await db
    .insert(facilities)
    .values(
      realFacilities.map((f: GovFacility) => ({
        code: f.code,
        name: f.name,
        type: f.role,
        city: f.city,
        lat: f.lat,
        lng: f.lng,
        beds: f.beds,
      })),
    )
    .returning({ id: facilities.id, code: facilities.code, lat: facilities.lat, lng: facilities.lng, name: facilities.name });

  const byCode = new Map(facilityRows.map((f) => [f.code, f]));
  const hubRow = facilityRows.find((f) => f.code.startsWith("HUB")) ?? facilityRows[0];
  const spokeRows = facilityRows.filter((f) => f.id !== hubRow.id);
  if (spokeRows.length < 2) {
    throw new Error(`seed: need at least 1 hub + 2 spokes, got ${facilityRows.length} facilities total`);
  }
  const HUB = hubRow.id;

  // Scan-driven registration + movable scanner: exactly one scanner_state
  // row, pointing at the hub. No scan_events are seeded — that table is a
  // live log, not fixture data.
  await db.insert(scannerState).values({ id: 1, currentFacilityId: HUB });
  console.log(`seed: scanner_state seeded at ${hubRow.code}`);

  // The substitution scenario's "near" and "far" roles: prefer the
  // snapshot's known codes so the demo reproduces the exact 2km/22d vs
  // 30km/38h story every run; fall back to first/last spoke by insertion
  // order if a live fetch ever returns different facilities.
  const nearRow = byCode.get("SPK-DHN-SNCM") ?? spokeRows[0];
  const farRow = byCode.get("SPK-BOK-SAI") ?? spokeRows[spokeRows.length - 1];
  const otherSpokeRows = spokeRows.filter((f) => f.id !== nearRow.id && f.id !== farRow.id);

  const demo = solveDemoPoint(
    { lat: Number(nearRow.lat), lng: Number(nearRow.lng) },
    { lat: Number(farRow.lat), lng: Number(farRow.lng) },
    2,
    30,
  );
  console.log(
    `seed: demo request point ${demo.point.lat.toFixed(6)},${demo.point.lng.toFixed(6)} — ` +
      `2.00km from ${nearRow.name}, ${demo.dist.toFixed(2)}km from ${farRow.name}`,
  );
  const hubDistanceKm = haversineKm(demo.point, { lat: Number(hubRow.lat), lng: Number(hubRow.lng) });

  // ─── Ambient temperature (ARCHITECTURE.md section 5B item 7, optional) ──
  // Open-Meteo, no API key, seed-time only. Best-effort: a facility whose
  // fetch fails just keeps ambient_c null (see lib/data/openmeteo.ts).
  const ambientResults = await Promise.all(
    facilityRows.map(async (f) => ({
      id: f.id,
      ambientC: await fetchAmbientC(Number(f.lat), Number(f.lng)),
    })),
  );
  let ambientFetched = 0;
  for (const r of ambientResults) {
    if (r.ambientC === null) continue;
    await db.update(facilities).set({ ambientC: r.ambientC.toFixed(2) }).where(eq(facilities.id, r.id));
    ambientFetched++;
  }
  console.log(`seed: ambient temperature fetched for ${ambientFetched}/${facilityRows.length} facilities`);

  // ─── Reserve floors (ARCHITECTURE.md section 5A) ───────────────────────
  // Every spoke: O_NEG floor 4, O_POS floor 6. Hub: O_NEG floor 10, O_POS
  // floor 12. Units inside the floor are invisible to network allocation —
  // this is what makes the substitution scenario below meaningful: both
  // engineered units are seeded WELL above their facility's floor.
  await db.insert(reserveFloors).values([
    ...spokeRows.flatMap((f) => [
      { facilityId: f.id, bloodGroup: "O_NEG" as const, component: "PRBC" as const, minUnits: 4 },
      { facilityId: f.id, bloodGroup: "O_POS" as const, component: "PRBC" as const, minUnits: 6 },
    ]),
    { facilityId: HUB, bloodGroup: "O_NEG" as const, component: "PRBC" as const, minUnits: 10 },
    { facilityId: HUB, bloodGroup: "O_POS" as const, component: "PRBC" as const, minUnits: 12 },
  ]);
  console.log(`seed: ${spokeRows.length * 2 + 2} reserve_floors rows`);

  // ─── Devices ────────────────────────────────────────────────────────
  const deviceValues = [
    { label: `${hubRow.name} Scanner 1`, kind: "SCANNER" as const, facilityId: HUB, deviceKey: "DEV-HUB-SCANNER-01" },
    { label: `${hubRow.name} Fridge 1`, kind: "FRIDGE" as const, facilityId: HUB, deviceKey: "DEV-HUB-FRIDGE-01" },
    { label: "Shipper Logger 1", kind: "SHIPPER" as const, facilityId: HUB, deviceKey: "DEV-SHIPPER-01" },
  ];
  // A fridge at every spoke except the "far" one, mirroring ARCHITECTURE.md
  // section 11's "1 fridge each at three spokes" for a 4-spoke network.
  for (const f of spokeRows.filter((s) => s.id !== farRow.id)) {
    deviceValues.push({
      label: `${f.name} Fridge 1`,
      kind: "FRIDGE" as const,
      facilityId: f.id,
      deviceKey: `DEV-${f.id.slice(0, 8).toUpperCase()}-FRIDGE-01`,
    });
  }
  const deviceRows = await db.insert(devices).values(deviceValues).returning({ id: devices.id, label: devices.label });
  console.log(`seed: ${deviceRows.length} devices (demo key: DEV-HUB-SCANNER-01)`);

  // ─── Blood units ────────────────────────────────────────────────────
  type UnitSpec = {
    bloodGroup: BloodGroup;
    component: Component;
    status: UnitStatus;
    collectedAt: Date;
    currentFacilityId: string;
  };

  // Note: #4 and #6 below use B_POS/A_NEG rather than the O_POS/O_NEG their
  // slot names might suggest. Any O_POS/O_NEG PRBC unit inside the risk
  // window would out-compete the deliberate substitution scenario seeded
  // below (its near-zero TTL salvage term dominates any distance/rarity
  // penalty), so those two groups are kept out of the general at-risk pool
  // and reserved for the engineered scenario units only.
  const atRiskSpecs: UnitSpec[] = [
    { bloodGroup: "O_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 31), currentFacilityId: HUB },
    { bloodGroup: "A_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 20), currentFacilityId: HUB },
    { bloodGroup: "B_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 44), currentFacilityId: HUB },
    { bloodGroup: "B_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 216), currentFacilityId: HUB },
    { bloodGroup: "A_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 144), currentFacilityId: nearRow.id },
    { bloodGroup: "A_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 48), currentFacilityId: otherSpokeRows[0]?.id ?? HUB },
    { bloodGroup: "B_POS", component: "WHOLE", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.WHOLE - 120), currentFacilityId: HUB },
    { bloodGroup: "AB_POS", component: "PLASMA", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLASMA - 480), currentFacilityId: HUB },
  ];

  // ─── Deliberate substitution scenario (ARCHITECTURE.md section 5A) ─────
  // Demo request point: computed above, exactly 2 km from `nearRow` and as
  // close to 30 km from `farRow` as the real coordinates allow.
  // `nearRow` holds an exact O_POS match with 22 days remaining, seeded as
  // that facility's sole network-visible compatible unit (6 fresher fillers
  // absorb its O_POS reserve floor of 6, so this one is the sole surplus
  // unit — "last compatible unit at its facility", +30 cost). `farRow`
  // holds an O_NEG unit with 38 hours remaining, seeded alongside other
  // stock so it is not its facility's last visible unit (no +30 cost).
  // cost(near O+)  = 0.5*2  - 100*(1-528/1008) + 30        ≈ -16.6
  // cost(far  O-)  = 0.5*30 + 25*2.0 - 100*(1-38/1008)      ≈ -31.2
  // The far unit wins on cost despite being ~15x farther and cross-group.
  const substitutionScenarioSpecs: UnitSpec[] = [
    // near: O_POS PRBC. 6 fresh fillers (fill the floor of 6) + 1 target.
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(58), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(108), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(158), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(208), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(258), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(308), currentFacilityId: nearRow.id },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(480), currentFacilityId: nearRow.id }, // target: 528h = 22d remaining
    // far: O_NEG PRBC. 4 fresh fillers (fill the floor of 4) + 1 surplus
    // filler (keeps the target from being the lone visible unit) + 1 target.
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(108), currentFacilityId: farRow.id },
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(158), currentFacilityId: farRow.id },
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(208), currentFacilityId: farRow.id },
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(258), currentFacilityId: farRow.id },
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(508), currentFacilityId: farRow.id }, // surplus filler, 500h remaining
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(970), currentFacilityId: farRow.id }, // target: 38h remaining
  ];

  // Hub reserve filler: guarantees the Hub carries genuine surplus O_POS/O_NEG
  // PRBC above its (12, 10) floor, so an EMERGENCY draw at a spoke has a real
  // unit to replenish from (ARCHITECTURE.md section 5A: "auto-create a
  // REQUESTED transfer to the nearest hub to replenish the floor"). The
  // O_POS filler is kept unusually fresh (>=900h remaining) rather than the
  // general 800h floor used elsewhere: the Hub sits close enough to the demo
  // point (~{hubDistanceKm} km) that ordinary-freshness stock there could
  // otherwise out-cost the engineered near-target and hijack the "exact
  // match" half of the substitution scenario's reason string. O_NEG filler
  // doesn't need this — the 25*rarityWeight substitution penalty already
  // keeps it far short of the far-target's cost regardless of freshness.
  const hubReserveFillerSpecs: UnitSpec[] = [
    ...Array.from({ length: 15 }, (_, i) => ({
      bloodGroup: "O_POS" as BloodGroup,
      component: "PRBC" as Component,
      status: "AVAILABLE" as UnitStatus,
      collectedAt: hoursAgo(48 + i * 4), // remaining: 960 down to 904h
      currentFacilityId: HUB,
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      bloodGroup: "O_NEG" as BloodGroup,
      component: "PRBC" as Component,
      status: "AVAILABLE" as UnitStatus,
      collectedAt: hoursAgo(1008 - (960 - i * 10)), // remaining: 960 down to 850h
      currentFacilityId: HUB,
    })),
  ];

  const bloodGroupPool = shuffle(
    pool<BloodGroup>([
      ["O_POS", 32],
      ["A_POS", 20],
      ["B_POS", 28],
      ["AB_POS", 7],
      ["O_NEG", 9],
      ["A_NEG", 6],
      ["B_NEG", 7],
      ["AB_NEG", 3],
    ]),
  );
  const componentPool = shuffle(
    pool<Component>([
      ["PRBC", 57],
      ["PLATELET", 17],
      ["WHOLE", 19],
      ["PLASMA", 19],
    ]),
  );
  const statusPool = shuffle(
    pool<UnitStatus>([
      ["AVAILABLE", 82],
      ["COLLECTED", 6],
      ["TESTING", 6],
      ["RESERVED", 4],
      ["IN_TRANSIT", 3],
      ["ISSUED", 3],
      ["TRANSFUSED", 4],
      ["QUARANTINED", 2],
      ["DISCARDED", 2],
    ]),
  );
  // The general random pool covers the Hub plus every spoke EXCEPT `far`
  // (which stays hand-authored only, so its O_NEG count stays exactly 6 —
  // see the fixup below for why `near` also needs protecting despite being
  // in this pool).
  const poolFacilities = [HUB, nearRow.id, ...otherSpokeRows.map((f) => f.id)];
  const facilityWeights: [string, number][] = poolFacilities.map((id, i) => [
    id,
    i === 0 ? 99 - (poolFacilities.length - 1) * 14 : 14,
  ]);
  const facilityPoolTotal = facilityWeights.reduce((s, [, w]) => s + w, 0);
  const REST_COUNT = facilityPoolTotal; // keep the pools' internal lengths self-consistent
  const facilityPool = shuffle(pool<string>(facilityWeights));

  // Safe collection ages: pick a point strictly outside the risk window, but
  // inside the shelf life, so these units are never accidentally at-risk or
  // expired.
  const RISK_WINDOW_HOURS: Record<Component, number> = {
    PLATELET: 48,
    WHOLE: 7 * 24,
    PRBC: 10 * 24,
    PLASMA: 30 * 24,
  };

  const restSpecs: UnitSpec[] = [];
  for (let i = 0; i < REST_COUNT; i++) {
    const component = componentPool[i % componentPool.length];
    const bloodGroup = bloodGroupPool[i % bloodGroupPool.length];
    const shelfHours = SHELF_LIFE_HOURS[component];
    const riskHours = RISK_WINDOW_HOURS[component];
    const safeMaxAgeHours = shelfHours - riskHours - 6; // 6h buffer clear of the window
    let ageHours = 6 + rng() * Math.max(1, safeMaxAgeHours - 6);
    // Keep random O_POS/O_NEG PRBC stock well clear of the substitution
    // scenario's cost range (>=800h remaining, ttlSalvage >= -20.6) so no
    // randomly-placed unit can out-cost either engineered unit above and
    // hijack the demo.
    if (component === "PRBC" && (bloodGroup === "O_POS" || bloodGroup === "O_NEG")) {
      ageHours = Math.min(ageHours, 208);
    }
    restSpecs.push({
      bloodGroup,
      component,
      status: statusPool[i % statusPool.length],
      collectedAt: hoursAgo(ageHours),
      currentFacilityId: facilityPool[i],
    });
  }

  // Guarantee: `near`'s O_POS/O_NEG PRBC stock is exactly the 7 hand-placed
  // substitution-scenario units above, and no spoke other than `near`/`far`
  // ever holds any (a stray unit 1-2km closer than `near` would steal the
  // "exact match" role in the reason string). Anything that lands wrong is
  // reassigned to the Hub, then clamped to the tight freshness floor if it
  // landed there — same reasoning as the hand-authored Hub filler above.
  let reassigned = 0;
  for (const spec of restSpecs) {
    const onNear = spec.currentFacilityId === nearRow.id;
    const onOtherSpoke = otherSpokeRows.some((f) => f.id === spec.currentFacilityId);
    const isTargetGroup = spec.component === "PRBC" && (spec.bloodGroup === "O_POS" || spec.bloodGroup === "O_NEG");
    if (isTargetGroup && (onNear || onOtherSpoke)) {
      spec.currentFacilityId = HUB;
      reassigned++;
    }
  }
  for (const spec of restSpecs) {
    if (spec.currentFacilityId === HUB && spec.component === "PRBC" && spec.bloodGroup === "O_POS") {
      const ageHours = (now.getTime() - spec.collectedAt.getTime()) / HOUR;
      if (ageHours > 108) {
        spec.collectedAt = hoursAgo(Math.min(ageHours, 108));
      }
    }
  }
  if (reassigned > 0) {
    console.log(`seed: reassigned ${reassigned} O+/O- PRBC unit(s) to the Hub to protect the substitution scenario`);
  }

  const allSpecs = [...atRiskSpecs, ...restSpecs, ...substitutionScenarioSpecs, ...hubReserveFillerSpecs];

  const unitRows = allSpecs.map((spec, i) => {
    const expiresAt = new Date(
      spec.collectedAt.getTime() + SHELF_LIFE_HOURS[spec.component] * HOUR,
    );
    const natTested = NAT_TESTED_STATUSES.includes(spec.status);
    return {
      rfidUid: (0x0a000000 + i).toString(16).toUpperCase().padStart(8, "0"),
      donorRef: `DNR-${String(i + 1).padStart(4, "0")}`,
      bloodGroup: spec.bloodGroup,
      component: spec.component,
      status: spec.status,
      natTested,
      collectedAt: spec.collectedAt,
      expiresAt,
      currentFacilityId: spec.currentFacilityId,
      originFacilityId: HUB,
      quarantineReason: spec.status === "QUARANTINED" ? "Cold-chain breach (seed)" : null,
    };
  });

  const insertedUnits = await db
    .insert(bloodUnits)
    .values(unitRows)
    .returning({
      id: bloodUnits.id,
      rfidUid: bloodUnits.rfidUid,
      component: bloodUnits.component,
      bloodGroup: bloodUnits.bloodGroup,
      status: bloodUnits.status,
      natTested: bloodUnits.natTested,
      collectedAt: bloodUnits.collectedAt,
      currentFacilityId: bloodUnits.currentFacilityId,
    });
  console.log(`seed: ${insertedUnits.length} blood units`);

  // One genesis custody event per unit, hash computed at insert time
  // (ARCHITECTURE.md section 5A) rather than backfilled after the fact.
  // Every unit's chain starts here, so prevHash is always null (GENESIS).
  await db.insert(custodyEvents).values(
    insertedUnits.map((u) => {
      const occurredAt = u.collectedAt;
      const eventHash = hashEvent(null, {
        unitId: u.id,
        eventType: "COLLECTED",
        fromFacilityId: null,
        toFacilityId: HUB,
        occurredAt,
      });
      return {
        unitId: u.id,
        eventType: "COLLECTED" as const,
        fromFacilityId: null,
        toFacilityId: HUB,
        occurredAt,
        meta: {},
        prevHash: null,
        eventHash,
      };
    }),
  );

  // ─── Opening credit balances ────────────────────────────────────────
  // hub +6, two spokes 0, one spoke -3 per ARCHITECTURE.md section 11. With
  // exactly 4 spokes, the 4th (unstated) spoke also opens at -3 to close
  // SUM(delta) = 0 across the whole ledger without touching the three
  // balances the doc does name.
  const openingBalances: [string, number][] = [[HUB, 6]];
  spokeRows.forEach((f, i) => {
    openingBalances.push([f.id, i < 2 ? 0 : -3]);
  });
  await db.insert(creditLedger).values(
    openingBalances.map(([facilityId, balance]) => ({
      facilityId,
      delta: balance,
      balanceAfter: balance,
      transferId: null,
      reason: "Opening balance (seed)",
    })),
  );

  // ─── SLA contracts + demand signals ─────────────────────────────────
  const tiers: ["GOLD", "SILVER", "BRONZE", "SILVER"] = ["GOLD", "SILVER", "BRONZE", "SILVER"];
  const feesRupees: [number, number, number, number] = [12_00_000, 6_00_000, 3_00_000, 6_00_000];
  const slaBySpoke: [string, string, number][] = spokeRows.map((f, i) => [
    f.id,
    tiers[i % tiers.length],
    feesRupees[i % feesRupees.length],
  ]);
  const responseMinutesByTier: Record<string, number> = {
    GOLD: 15,
    SILVER: 30,
    BRONZE: 60,
  };
  const slaRows = await db
    .insert(slaContracts)
    .values(
      slaBySpoke.map(([facilityId, tier, annualRupees]) => ({
        facilityId,
        tier,
        annualFeePaise: annualRupees * 100,
        responseMinutes: responseMinutesByTier[tier],
        startedOn: daysAgo(180).toISOString().slice(0, 10),
      })),
    )
    .returning({
      id: slaContracts.id,
      facilityId: slaContracts.facilityId,
      tier: slaContracts.tier,
      annualFeePaise: slaContracts.annualFeePaise,
    });

  const GROUP_SHARE: Record<BloodGroup, number> = {
    O_POS: 0.3,
    A_POS: 0.2,
    B_POS: 0.25,
    AB_POS: 0.07,
    O_NEG: 0.09,
    A_NEG: 0.04,
    B_NEG: 0.03,
    AB_NEG: 0.02,
  };
  const COMPONENT_BASE: Record<string, number> = {
    PRBC: 3.0,
    PLATELET: 1.2,
    PLASMA: 0.8,
  };
  const AVG_BEDS = 300;
  const spokeBedsById: Record<string, number> = Object.fromEntries(
    facilityRows
      .filter((f) => spokeRows.some((s) => s.id === f.id))
      .map((f) => [f.id, realFacilities.find((rf) => rf.code === f.code)?.beds ?? AVG_BEDS]),
  );

  const demandRows: (typeof demandSignals.$inferInsert)[] = [];
  const spokes = spokeRows.map((f) => f.id);
  for (const facilityId of spokes) {
    const sizeFactor = (spokeBedsById[facilityId] ?? AVG_BEDS) / AVG_BEDS;
    for (const component of ["PRBC", "PLATELET", "PLASMA"] as const) {
      for (const bloodGroup of Object.keys(GROUP_SHARE) as BloodGroup[]) {
        const baseRate =
          COMPONENT_BASE[component] * GROUP_SHARE[bloodGroup] * sizeFactor;
        for (let d = 89; d >= 0; d--) {
          const day = daysAgo(d);
          const isWeekday = day.getUTCDay() >= 1 && day.getUTCDay() <= 5;
          const weekdayFactor = isWeekday ? 1.2 : 0.6;
          const jitter = 0.7 + rng() * 0.6;
          const unitsUsed = Math.max(
            0,
            Math.round(baseRate * weekdayFactor * jitter),
          );
          demandRows.push({
            facilityId,
            bloodGroup,
            component,
            day: day.toISOString().slice(0, 10),
            unitsUsed,
          });
        }
      }
    }
  }
  for (let i = 0; i < demandRows.length; i += 1000) {
    await db.insert(demandSignals).values(demandRows.slice(i, i + 1000));
  }
  console.log(`seed: ${demandRows.length} demand_signals rows`);

  // ─── Billing lines (six weeks of history) ───────────────────────────
  // ARCHITECTURE.md section 8: no service code for the blood itself, ever.
  const billingRows: (typeof billingLines.$inferInsert)[] = [];
  const withinSixWeeks = () => daysAgo(rng() * 42);

  for (const u of insertedUnits) {
    if (!u.natTested) continue;
    billingRows.push({
      facilityId: HUB,
      unitId: u.id,
      code: "NAT_TESTING",
      description: `NAT testing — ${u.rfidUid}`,
      amountPaise: 65_000,
      createdAt: withinSixWeeks(),
    });
    if (u.component !== "WHOLE") {
      billingRows.push({
        facilityId: HUB,
        unitId: u.id,
        code: "COMPONENT_PREP",
        description: `Component preparation — ${u.rfidUid}`,
        amountPaise: 30_000,
        createdAt: withinSixWeeks(),
      });
    }
    if (u.currentFacilityId !== HUB) {
      billingRows.push({
        facilityId: u.currentFacilityId,
        unitId: u.id,
        code: "COLD_CHAIN_STORAGE",
        description: `Cold-chain storage — ${u.rfidUid}`,
        amountPaise: 25_000,
        createdAt: withinSixWeeks(),
      });
      billingRows.push({
        facilityId: u.currentFacilityId,
        unitId: u.id,
        code: "LAST_MILE_LOGISTICS",
        description: `Last-mile logistics — ${u.rfidUid}`,
        amountPaise: 8_000,
        createdAt: withinSixWeeks(),
      });
    }
  }
  for (const contract of slaRows) {
    for (const monthsAgo of [1, 0]) {
      billingRows.push({
        facilityId: contract.facilityId,
        unitId: null,
        code: "PLATFORM_SLA",
        description: `Platform SLA — ${contract.tier} tier`,
        amountPaise: Math.round(contract.annualFeePaise / 12),
        createdAt: daysAgo(monthsAgo * 30 + rng() * 5),
      });
    }
  }
  for (let i = 0; i < billingRows.length; i += 500) {
    await db.insert(billingLines).values(billingRows.slice(i, i + 500));
  }
  console.log(`seed: ${billingRows.length} billing_lines rows`);

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log("\n--- seed summary ---");

  const byStatus = await db.execute<{ status: string; count: string }>(sql`
    SELECT status, COUNT(*) FROM blood_units GROUP BY status ORDER BY status
  `);
  console.log("\nUnits by status:");
  console.table(byStatus.rows);

  const byComponent = await db.execute<{ component: string; count: string }>(sql`
    SELECT component, COUNT(*) FROM blood_units GROUP BY component ORDER BY component
  `);
  console.log("\nUnits by component:");
  console.table(byComponent.rows);

  const atRisk = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) FROM blood_units
    WHERE status = 'AVAILABLE' AND (
      (component = 'PLATELET' AND expires_at < now() + interval '48 hours') OR
      (component = 'WHOLE'    AND expires_at < now() + interval '7 days') OR
      (component = 'PRBC'     AND expires_at < now() + interval '10 days') OR
      (component = 'PLASMA'   AND expires_at < now() + interval '30 days')
    )
  `);
  console.log(`\nUnits currently at risk: ${atRisk.rows[0].count}`);

  const platelet36h = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) FROM blood_units
    WHERE status = 'AVAILABLE' AND component = 'PLATELET'
      AND expires_at < now() + interval '36 hours' AND expires_at > now()
  `);
  console.log(`Platelet units expiring within 36h: ${platelet36h.rows[0].count}`);

  const shortSpokes = await db.execute<{ code: string; count: string }>(sql`
    SELECT f.code, COUNT(*) FROM blood_units bu
    JOIN facilities f ON f.id = bu.current_facility_id
    WHERE f.type = 'SPOKE' AND bu.blood_group = 'O_POS' AND bu.component = 'PRBC'
    GROUP BY f.code ORDER BY f.code
  `);
  console.log("\nO+ PRBC on hand per spoke (expect the non-near, non-far spokes at 0):");
  console.table(shortSpokes.rows);

  const scenarioStock = await db.execute<{ code: string; blood_group: string; count: string }>(sql`
    SELECT f.code, bu.blood_group, COUNT(*) FROM blood_units bu
    JOIN facilities f ON f.id = bu.current_facility_id
    WHERE f.id IN (${nearRow.id}, ${farRow.id}, ${HUB})
      AND bu.component = 'PRBC' AND bu.blood_group IN ('O_POS', 'O_NEG') AND bu.status = 'AVAILABLE'
    GROUP BY f.code, bu.blood_group ORDER BY f.code, bu.blood_group
  `);
  console.log(`\nSubstitution + replenishment stock (expect ${nearRow.name}/O_POS=7, ${farRow.name}/O_NEG=6, Hub/O_POS>=15, Hub/O_NEG>=12):`);
  console.table(scenarioStock.rows);

  const balances = await db.execute<{ code: string; balance: string }>(sql`
    SELECT f.code, SUM(cl.delta) as balance
    FROM credit_ledger cl JOIN facilities f ON f.id = cl.facility_id
    GROUP BY f.code ORDER BY f.code
  `);
  console.log("\nCredit balance per facility:");
  console.table(balances.rows);

  const sumDelta = await db.execute<{ sum: string }>(
    sql`SELECT COALESCE(SUM(delta), 0) as sum FROM credit_ledger`,
  );
  console.log(`SUM(delta) across credit_ledger: ${sumDelta.rows[0].sum}`);

  console.log(
    `\nDemo curl coordinates — ROUTINE substitution: lat=${demo.point.lat.toFixed(6)} lng=${demo.point.lng.toFixed(6)}`,
  );
  console.log(`Demo curl coordinates — EMERGENCY at near spoke: lat=${nearRow.lat} lng=${nearRow.lng}`);
  console.log(`Hub distance from demo point: ${hubDistanceKm.toFixed(2)} km`);

  console.log("\nseed: done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export {};

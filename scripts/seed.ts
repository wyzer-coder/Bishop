// ARCHITECTURE.md section 11: deterministic seed, truncate-then-insert,
// re-runnable. `pnpm seed` must print identical *structure* every run
// (same facilities/devices, same group/component/status mix, same
// engineered at-risk units) — see the note on `now` below for the one
// deliberate exception.
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  facilities,
  devices,
  bloodUnits,
  custodyEvents,
  creditLedger,
  demandSignals,
  slaContracts,
  billingLines,
} from "@/lib/schema";

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

async function main() {
  console.log(`seed: starting, now = ${now.toISOString()}`);

  await db.execute(sql`
    TRUNCATE TABLE
      billing_lines, sla_contracts, demand_signals, credit_ledger,
      transfers, breaches, telemetry, shipment_units, shipments,
      custody_events, blood_units, devices, users, facilities
    RESTART IDENTITY CASCADE
  `);

  // ─── Facilities ─────────────────────────────────────────────────────
  const facilityRows = await db
    .insert(facilities)
    .values([
      {
        code: "HUB-CHN-01",
        name: "Bishop Central Blood Bank",
        type: "HUB",
        city: "Chennai",
        lat: "13.082700",
        lng: "80.270700",
        beds: null,
      },
      {
        code: "SPK-CHN-APOLLO",
        name: "Apollo Hospitals Vanagaram",
        type: "SPOKE",
        city: "Chennai",
        lat: "13.056900",
        lng: "80.101700",
        beds: 500,
      },
      {
        code: "SPK-CHN-SIMS",
        name: "SIMS Hospital Vadapalani",
        type: "SPOKE",
        city: "Chennai",
        lat: "13.050300",
        lng: "80.212100",
        beds: 400,
      },
      {
        code: "SPK-CHN-STANLEY",
        name: "Government Stanley Medical College Hospital",
        type: "SPOKE",
        city: "Chennai",
        lat: "13.114700",
        lng: "80.291100",
        beds: 800,
      },
      {
        code: "SPK-CHN-MIOT",
        name: "MIOT International",
        type: "SPOKE",
        city: "Chennai",
        lat: "13.006700",
        lng: "80.155300",
        beds: 500,
      },
    ])
    .returning({ id: facilities.id, code: facilities.code });

  const facilityIdByCode = Object.fromEntries(
    facilityRows.map((f) => [f.code, f.id]),
  ) as Record<string, string>;
  const HUB = facilityIdByCode["HUB-CHN-01"];
  const APOLLO = facilityIdByCode["SPK-CHN-APOLLO"];
  const SIMS = facilityIdByCode["SPK-CHN-SIMS"];
  const STANLEY = facilityIdByCode["SPK-CHN-STANLEY"];
  const MIOT = facilityIdByCode["SPK-CHN-MIOT"];

  // ─── Devices ────────────────────────────────────────────────────────
  const deviceRows = await db
    .insert(devices)
    .values([
      {
        label: "Hub Scanner 1",
        kind: "SCANNER",
        facilityId: HUB,
        deviceKey: "DEV-HUB-SCANNER-01",
      },
      {
        label: "Hub Fridge 1",
        kind: "FRIDGE",
        facilityId: HUB,
        deviceKey: "DEV-HUB-FRIDGE-01",
      },
      {
        label: "Apollo Fridge 1",
        kind: "FRIDGE",
        facilityId: APOLLO,
        deviceKey: "DEV-APOLLO-FRIDGE-01",
      },
      {
        label: "SIMS Fridge 1",
        kind: "FRIDGE",
        facilityId: SIMS,
        deviceKey: "DEV-SIMS-FRIDGE-01",
      },
      {
        label: "Stanley Fridge 1",
        kind: "FRIDGE",
        facilityId: STANLEY,
        deviceKey: "DEV-STANLEY-FRIDGE-01",
      },
      {
        label: "Shipper Logger 1",
        kind: "SHIPPER",
        facilityId: HUB,
        deviceKey: "DEV-SHIPPER-01",
      },
    ])
    .returning({ id: devices.id, label: devices.label });
  console.log(`seed: ${deviceRows.length} devices (demo key: DEV-HUB-SCANNER-01)`);

  // ─── Blood units ────────────────────────────────────────────────────
  // 8 units engineered to sit inside their component's risk window right now,
  // including 2 platelets under the dramatic 36-hour mark (one at 31h to match
  // the demo script in ARCHITECTURE.md section 11).
  type UnitSpec = {
    bloodGroup: BloodGroup;
    component: Component;
    status: UnitStatus;
    collectedAt: Date;
    currentFacilityId: string;
  };

  const atRiskSpecs: UnitSpec[] = [
    { bloodGroup: "O_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 31), currentFacilityId: HUB },
    { bloodGroup: "A_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 20), currentFacilityId: HUB },
    { bloodGroup: "B_POS", component: "PLATELET", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLATELET - 44), currentFacilityId: HUB },
    { bloodGroup: "O_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 216), currentFacilityId: HUB },
    { bloodGroup: "A_POS", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 144), currentFacilityId: APOLLO },
    { bloodGroup: "O_NEG", component: "PRBC", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PRBC - 48), currentFacilityId: SIMS },
    { bloodGroup: "B_POS", component: "WHOLE", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.WHOLE - 120), currentFacilityId: HUB },
    { bloodGroup: "AB_POS", component: "PLASMA", status: "AVAILABLE", collectedAt: hoursAgo(SHELF_LIFE_HOURS.PLASMA - 480), currentFacilityId: HUB },
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
  const facilityPool = shuffle(
    pool<string>([
      [HUB, 64],
      [APOLLO, 14],
      [SIMS, 14],
      [STANLEY, 10],
      [MIOT, 10],
    ]),
  );

  // Safe collection ages: pick a point strictly outside the risk window, but
  // inside the shelf life, so these 112 units are never accidentally at-risk
  // or expired.
  const RISK_WINDOW_HOURS: Record<Component, number> = {
    PLATELET: 48,
    WHOLE: 7 * 24,
    PRBC: 10 * 24,
    PLASMA: 30 * 24,
  };

  const restSpecs: UnitSpec[] = [];
  for (let i = 0; i < 112; i++) {
    const component = componentPool[i];
    const shelfHours = SHELF_LIFE_HOURS[component];
    const riskHours = RISK_WINDOW_HOURS[component];
    const safeMaxAgeHours = shelfHours - riskHours - 6; // 6h buffer clear of the window
    const ageHours = 6 + rng() * Math.max(1, safeMaxAgeHours - 6);
    restSpecs.push({
      bloodGroup: bloodGroupPool[i],
      component,
      status: statusPool[i],
      collectedAt: hoursAgo(ageHours),
      currentFacilityId: facilityPool[i],
    });
  }

  // Guarantee: Stanley never holds O+ PRBC stock (ARCHITECTURE.md section 11).
  let stanleyFixups = 0;
  for (const spec of restSpecs) {
    if (
      spec.currentFacilityId === STANLEY &&
      spec.bloodGroup === "O_POS" &&
      spec.component === "PRBC"
    ) {
      spec.currentFacilityId = HUB;
      stanleyFixups++;
    }
  }
  if (stanleyFixups > 0) {
    console.log(`seed: reassigned ${stanleyFixups} O+ PRBC unit(s) away from Stanley`);
  }

  const allSpecs = [...atRiskSpecs, ...restSpecs];

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

  // One genesis custody event per unit.
  await db.insert(custodyEvents).values(
    insertedUnits.map((u) => ({
      unitId: u.id,
      eventType: "COLLECTED" as const,
      fromFacilityId: null,
      toFacilityId: HUB,
      occurredAt: u.collectedAt,
      meta: {},
    })),
  );

  // ─── Opening credit balances ────────────────────────────────────────
  // hub +6, two spokes 0, one spoke -3 per ARCHITECTURE.md section 11. A 4th
  // spoke's balance isn't stated there, but ARCHITECTURE.md section 6 requires
  // SUM(delta) = 0 across the whole ledger table, and 6+0+0-3 = 3 != 0. Setting
  // the unstated 4th spoke (MIOT) to -3 too closes the loop without touching
  // the three balances the doc does name.
  const openingBalances: [string, number][] = [
    [HUB, 6],
    [APOLLO, 0],
    [SIMS, 0],
    [STANLEY, -3],
    [MIOT, -3],
  ];
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
  const slaBySpoke: [string, string, number][] = [
    [APOLLO, "GOLD", 12_00_000],
    [SIMS, "SILVER", 6_00_000],
    [STANLEY, "BRONZE", 3_00_000],
    [MIOT, "SILVER", 6_00_000],
  ];
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
  const spokeBedsById: Record<string, number> = {
    [APOLLO]: 500,
    [SIMS]: 400,
    [STANLEY]: 800,
    [MIOT]: 500,
  };

  const demandRows: (typeof demandSignals.$inferInsert)[] = [];
  const spokes = [APOLLO, SIMS, STANLEY, MIOT];
  for (const facilityId of spokes) {
    const sizeFactor = spokeBedsById[facilityId] / 500;
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

  const stanleyOPos = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) FROM blood_units bu
    JOIN facilities f ON f.id = bu.current_facility_id
    WHERE f.code = 'SPK-CHN-STANLEY' AND bu.blood_group = 'O_POS' AND bu.component = 'PRBC'
  `);
  console.log(`Stanley O+ PRBC units on hand: ${stanleyOPos.rows[0].count}`);

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

  console.log("\nseed: done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export {};

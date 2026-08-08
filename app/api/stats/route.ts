import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { allocationLog, billingLines, bloodUnits, breaches, creditLedger, facilities } from "@/lib/schema";
import { verifyAllChains } from "@/lib/domain/protocol";
import { RISK_WINDOW_HOURS, type Component } from "@/lib/domain/units";

// Phase 5B: the dashboard's network overview. Every number here is computed
// from the database on read — nothing hardcoded, no cached aggregate table.
export async function GET() {
  const allFacilities = await db.select().from(facilities).orderBy(facilities.name);

  const [{ totalUnits }] = await db.execute<{ totalUnits: string }>(
    sql`SELECT COUNT(*) as "totalUnits" FROM blood_units`,
  ).then((r) => r.rows as { totalUnits: string }[]);

  const [{ atRisk }] = await db.execute<{ atRisk: string }>(sql`
    SELECT COUNT(*) as "atRisk" FROM blood_units
    WHERE status = 'AVAILABLE' AND (
      (component = 'PLATELET' AND expires_at < now() + interval '48 hours') OR
      (component = 'WHOLE'    AND expires_at < now() + interval '7 days') OR
      (component = 'PRBC'     AND expires_at < now() + interval '10 days') OR
      (component = 'PLASMA'   AND expires_at < now() + interval '30 days')
    )
  `).then((r) => r.rows as { atRisk: string }[]);

  const chainValidity = await db.transaction((tx) => verifyAllChains(tx));
  const unroutable = [...chainValidity.values()].filter((valid) => !valid).length;

  const [{ openBreaches }] = await db.execute<{ openBreaches: string }>(
    sql`SELECT COUNT(*) as "openBreaches" FROM breaches`,
  ).then((r) => r.rows as { openBreaches: string }[]);

  const balances = await db
    .select({
      facilityId: creditLedger.facilityId,
      balance: sql<string>`COALESCE(SUM(${creditLedger.delta}), 0)`,
    })
    .from(creditLedger)
    .groupBy(creditLedger.facilityId);
  const facilityById = new Map(allFacilities.map((f) => [f.id, f]));
  const creditPosition = balances.map((b) => ({
    facilityId: b.facilityId,
    code: facilityById.get(b.facilityId)?.code ?? "?",
    name: facilityById.get(b.facilityId)?.name ?? "Unknown",
    balance: Number(b.balance),
  }));
  const facilitiesInDeficit = creditPosition.filter((b) => b.balance < 0).length;
  const facilitiesAtOverdraftLimit = creditPosition.filter((b) => b.balance <= -5).length;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const [{ revenuePaise }] = await db.execute<{ revenuePaise: string }>(sql`
    SELECT COALESCE(SUM(amount_paise), 0) as "revenuePaise" FROM billing_lines
    WHERE created_at >= ${startOfMonth.toISOString()}
  `).then((r) => r.rows as { revenuePaise: string }[]);

  // Wastage averted: allocation results whose TTL at the moment of
  // allocation was already inside the requested component's risk window —
  // i.e. units the network moved instead of letting expire unused.
  const logRows = await db.select().from(allocationLog).orderBy(desc(allocationLog.createdAt));
  let wastageAverted = 0;
  for (const row of logRows) {
    const riskHours = RISK_WINDOW_HOURS[row.requestedComponent as Component];
    const results = row.results as { ttlHours: number }[];
    for (const r of results) {
      if (r.ttlHours <= riskHours) wastageAverted++;
    }
  }

  const recentAllocations = logRows.slice(0, 5).map((row) => ({
    id: row.id,
    priority: row.priority,
    requestedGroup: row.requestedGroup,
    requestedComponent: row.requestedComponent,
    unitsRequested: row.unitsRequested,
    createdAt: row.createdAt.toISOString(),
    results: row.results as { bua: string; reason: string; creditCost: number }[],
  }));

  return NextResponse.json({
    facilityCount: allFacilities.length,
    facilities: allFacilities.map((f) => ({ id: f.id, code: f.code, name: f.name, city: f.city, type: f.type })),
    totalUnits: Number(totalUnits),
    unitsAtRisk: Number(atRisk),
    unitsUnroutable: unroutable,
    openBreaches: Number(openBreaches),
    creditPosition: {
      balances: creditPosition,
      facilitiesInDeficit,
      facilitiesAtOverdraftLimit,
    },
    serviceRevenuePaiseThisMonth: Number(revenuePaise),
    wastageAverted,
    recentAllocations,
  });
}

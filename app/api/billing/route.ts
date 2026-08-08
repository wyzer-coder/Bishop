import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingLines, facilities } from "@/lib/schema";

// ARCHITECTURE.md section 9 + Phase 5B: service lines with totals,
// filterable by facility. Never blood — see lib/domain/billing.ts's
// top-of-file rule.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const facilityId = searchParams.get("facility");

  const allFacilities = await db.select().from(facilities).orderBy(facilities.name);

  const lineWhere = facilityId ? eq(billingLines.facilityId, facilityId) : undefined;

  const totalsByCode = await db
    .select({
      code: billingLines.code,
      count: sql<string>`COUNT(*)`,
      amountPaise: sql<string>`COALESCE(SUM(${billingLines.amountPaise}), 0)`,
    })
    .from(billingLines)
    .where(lineWhere)
    .groupBy(billingLines.code)
    .orderBy(billingLines.code);

  const lines = await db
    .select({
      id: billingLines.id,
      code: billingLines.code,
      description: billingLines.description,
      amountPaise: billingLines.amountPaise,
      createdAt: billingLines.createdAt,
      facilityId: billingLines.facilityId,
      unitId: billingLines.unitId,
    })
    .from(billingLines)
    .where(lineWhere)
    .orderBy(desc(billingLines.createdAt))
    .limit(300);

  const facilityById = new Map(allFacilities.map((f) => [f.id, f]));
  const linesOut = lines.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
    facility: facilityById.get(l.facilityId) ?? null,
  }));

  const grandTotalPaise = totalsByCode.reduce((sum, t) => sum + Number(t.amountPaise), 0);

  return NextResponse.json({
    facilities: allFacilities.map((f) => ({ id: f.id, code: f.code, name: f.name })),
    totals: totalsByCode.map((t) => ({ code: t.code, count: Number(t.count), amountPaise: Number(t.amountPaise) })),
    lines: linesOut,
    grandTotalPaise,
  });
}

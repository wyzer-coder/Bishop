import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, facilities } from "@/lib/schema";

// ARCHITECTURE.md section 9: units, filterable by facility, group, component,
// status. Clerk-protected (middleware.ts runs on every /api/* path except
// /api/ingest/*). Polled by TanStack Query every 4000ms — keep this cheap;
// it's a single indexed query, no N+1.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const facilityId = searchParams.get("facility");
  const bloodGroup = searchParams.get("bloodGroup");
  const component = searchParams.get("component");
  const status = searchParams.get("status");

  const conditions: SQL[] = [];
  if (facilityId) conditions.push(eq(bloodUnits.currentFacilityId, facilityId));
  if (bloodGroup) {
    conditions.push(
      eq(bloodUnits.bloodGroup, bloodGroup as (typeof bloodUnits.bloodGroup.enumValues)[number]),
    );
  }
  if (component) {
    conditions.push(
      eq(bloodUnits.component, component as (typeof bloodUnits.component.enumValues)[number]),
    );
  }
  if (status) {
    conditions.push(
      eq(bloodUnits.status, status as (typeof bloodUnits.status.enumValues)[number]),
    );
  }

  const rows = await db
    .select({
      id: bloodUnits.id,
      rfidUid: bloodUnits.rfidUid,
      bloodGroup: bloodUnits.bloodGroup,
      component: bloodUnits.component,
      status: bloodUnits.status,
      collectedAt: bloodUnits.collectedAt,
      currentFacilityId: bloodUnits.currentFacilityId,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(bloodUnits)
    .innerJoin(facilities, eq(facilities.id, bloodUnits.currentFacilityId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(bloodUnits.expiresAt));

  return NextResponse.json({ units: rows });
}

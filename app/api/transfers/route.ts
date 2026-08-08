import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, facilities, transfers } from "@/lib/schema";

// GET: list transfers for the /transfers page. Not named in ARCHITECTURE.md
// section 9's table (only POST /api/transfers is), but the page needs a way
// to list pending/resolved transfers, same reasoning as GET /api/devices in
// Phase 4.
export async function GET() {
  const rows = await db
    .select({
      id: transfers.id,
      status: transfers.status,
      credits: transfers.credits,
      reason: transfers.reason,
      createdAt: transfers.createdAt,
      resolvedAt: transfers.resolvedAt,
      unitId: transfers.unitId,
      unitRfidUid: bloodUnits.rfidUid,
      unitBloodGroup: bloodUnits.bloodGroup,
      unitComponent: bloodUnits.component,
      offeringFacilityId: transfers.offeringFacilityId,
      receivingFacilityId: transfers.receivingFacilityId,
    })
    .from(transfers)
    .innerJoin(bloodUnits, eq(bloodUnits.id, transfers.unitId))
    .orderBy(desc(transfers.createdAt));

  const allFacilities = await db.select().from(facilities);
  const facilityById = new Map(allFacilities.map((f) => [f.id, f]));

  const withFacilities = rows.map((r) => ({
    ...r,
    offeringFacility: facilityById.get(r.offeringFacilityId) ?? null,
    receivingFacility: facilityById.get(r.receivingFacilityId) ?? null,
  }));

  return NextResponse.json({ transfers: withFacilities });
}

// POST: create a REQUESTED transfer (ARCHITECTURE.md section 9).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.unitId !== "string" ||
    typeof body.receivingFacilityId !== "string"
  ) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const [unit] = await db.select().from(bloodUnits).where(eq(bloodUnits.id, body.unitId)).limit(1);
  if (!unit) {
    return NextResponse.json({ error: "UNIT_NOT_FOUND" }, { status: 404 });
  }
  if (unit.status !== "AVAILABLE") {
    return NextResponse.json({ error: "UNIT_NOT_AVAILABLE" }, { status: 409 });
  }

  const [created] = await db
    .insert(transfers)
    .values({
      unitId: unit.id,
      offeringFacilityId: unit.currentFacilityId,
      receivingFacilityId: body.receivingFacilityId,
      status: "REQUESTED",
      credits: 1,
      reason: typeof body.reason === "string" ? body.reason : "Manual transfer request",
      score: "0",
    })
    .returning();

  return NextResponse.json({ transfer: created }, { status: 201 });
}

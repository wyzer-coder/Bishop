import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scannerState, facilities } from "@/lib/schema";

// GET/PUT /api/scanner-location — the single physical scanner's current
// facility. Read by the "Scanner at" control in the app shell; changing it
// takes effect on the very next POST /api/ingest/scan. Clerk-protected.
export async function GET() {
  const [row] = await db.select().from(scannerState).where(eq(scannerState.id, 1)).limit(1);
  if (!row) {
    return NextResponse.json({ facilityId: null, updatedAt: null });
  }
  return NextResponse.json({ facilityId: row.currentFacilityId, updatedAt: row.updatedAt });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const facilityId = body?.facilityId as string | undefined;
  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const [facility] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
  if (!facility) {
    return NextResponse.json({ error: "Unknown facility" }, { status: 400 });
  }

  await db
    .update(scannerState)
    .set({ currentFacilityId: facilityId, updatedAt: new Date() })
    .where(eq(scannerState.id, 1));

  return NextResponse.json({ facilityId });
}

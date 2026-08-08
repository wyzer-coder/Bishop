import { NextResponse } from "next/server";
import { desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { scanEvents, facilities } from "@/lib/schema";

// GET /api/scans/latest — the most recent scan_events row from the last 60
// seconds, or null. Polled by ScanWatcher every 1500ms. Clerk-protected.
export async function GET() {
  const sixtySecondsAgo = new Date(Date.now() - 60000);
  const [row] = await db
    .select()
    .from(scanEvents)
    .where(gte(scanEvents.createdAt, sixtySecondsAgo))
    .orderBy(desc(scanEvents.createdAt))
    .limit(1);

  if (!row) {
    return NextResponse.json({ scan: null });
  }

  let facilityName: string | null = null;
  if (row.facilityId) {
    const [f] = await db
      .select({ name: facilities.name })
      .from(facilities)
      .where(eq(facilities.id, row.facilityId))
      .limit(1);
    facilityName = f?.name ?? null;
  }

  return NextResponse.json({
    scan: {
      id: row.id,
      rfidUid: row.rfidUid,
      outcome: row.outcome,
      detail: row.detail,
      unitId: row.unitId,
      facilityId: row.facilityId,
      facilityName,
      handled: row.handled,
      createdAt: row.createdAt,
    },
  });
}

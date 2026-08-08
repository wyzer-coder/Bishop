import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scanEvents } from "@/lib/schema";

// POST /api/scans/[id]/handle — marks a scan_events row handled, so
// ScanWatcher's dialog doesn't reopen for it on the next poll. Called on
// both a successful "Register unit" submit and on Cancel.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.update(scanEvents).set({ handled: true }).where(eq(scanEvents.id, id));
  return NextResponse.json({ ok: true });
}

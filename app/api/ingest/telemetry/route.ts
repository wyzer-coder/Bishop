import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDeviceByKey } from "@/lib/devices";
import { devices, telemetry } from "@/lib/schema";
import { recordTelemetry } from "@/lib/domain/coldchain";

// ARCHITECTURE.md section 9: device telemetry ingest. Unauthenticated by
// Clerk (excluded in middleware.ts); devices authenticate with X-Device-Key.
export async function POST(req: NextRequest) {
  const deviceKey = req.headers.get("X-Device-Key");
  if (!deviceKey) {
    return NextResponse.json({ error: "MISSING_DEVICE_KEY" }, { status: 401 });
  }
  const device = await getDeviceByKey(deviceKey);
  if (!device) {
    return NextResponse.json({ error: "INVALID_DEVICE_KEY" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.tempC !== "number") {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const {
    tempC,
    humidity = null,
    shipmentId = null,
    ts,
  } = body as {
    tempC: number;
    humidity?: number | null;
    shipmentId?: string | null;
    ts?: string;
  };
  const recordedAt = ts ? new Date(ts) : new Date();

  await db
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.id, device.id));

  // Idempotent-tolerant: an exact-value repeat from the same device within 5
  // seconds (loose breadboard wiring double-firing) is ignored. Matched on
  // value, not just recency, so the normal ~5s reporting cadence — and the
  // simulator's back-to-back breach burst, whose readings differ — both
  // still get recorded.
  const fiveSecondsAgo = new Date(Date.now() - 5000);
  const [dup] = await db
    .select({ id: telemetry.id })
    .from(telemetry)
    .where(
      and(
        eq(telemetry.deviceId, device.id),
        gte(telemetry.recordedAt, fiveSecondsAgo),
        sql`round(${telemetry.tempC}::numeric, 1) = round(${tempC}::numeric, 1)`,
      ),
    )
    .limit(1);
  if (dup) {
    return NextResponse.json({ ok: true, breach: false, duplicate: true });
  }

  const result = await db.transaction((tx) =>
    recordTelemetry(tx, {
      deviceId: device.id,
      facilityId: device.facilityId,
      shipmentId,
      tempC,
      humidity,
      recordedAt,
    }),
  );

  return NextResponse.json({ ok: true, breach: result.breach });
}

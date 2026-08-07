import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { devices, facilities } from "@/lib/schema";
import { eq } from "drizzle-orm";

// Clerk-protected. Includes device_key — intentional: /simulator (an
// in-app, signed-in-only demo tool) needs it to post the same payloads a
// real device would. See ARCHITECTURE.md section 14 on compiled-in device
// keys already being an accepted demo-only shortcut.
export async function GET() {
  const rows = await db
    .select({
      id: devices.id,
      label: devices.label,
      kind: devices.kind,
      deviceKey: devices.deviceKey,
      facilityId: devices.facilityId,
      facilityName: facilities.name,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .innerJoin(facilities, eq(facilities.id, devices.facilityId));

  return NextResponse.json({ devices: rows });
}

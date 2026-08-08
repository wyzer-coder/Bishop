import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDeviceByKey } from "@/lib/devices";
import { allocate, type Priority } from "@/lib/domain/matching";
import { BLOOD_GROUPS, COMPONENTS, type BloodGroup, type Component } from "@/lib/domain/units";
import { allocationLog } from "@/lib/schema";

const PRIORITIES: Priority[] = ["ROUTINE", "URGENT", "EMERGENCY"];

// ARCHITECTURE.md section 5A: the protocol's single call. Device-key
// authenticated like /api/ingest/*, excluded from Clerk in middleware.ts, so
// it can be demoed from a terminal with no browser session.
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
  if (
    !body ||
    !BLOOD_GROUPS.includes(body.group) ||
    !COMPONENTS.includes(body.component) ||
    typeof body.units !== "number" ||
    body.units < 1 ||
    typeof body.lat !== "number" ||
    typeof body.lng !== "number" ||
    (body.priority !== undefined && !PRIORITIES.includes(body.priority))
  ) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const request = {
    group: body.group as BloodGroup,
    component: body.component as Component,
    units: body.units as number,
    lat: body.lat as number,
    lng: body.lng as number,
    neededBy: body.neededBy as string | undefined,
    priority: (body.priority as Priority | undefined) ?? "ROUTINE",
  };

  const response = await db.transaction(async (tx) => {
    const result = await allocate(tx, request);
    await tx.insert(allocationLog).values({
      priority: request.priority!,
      requestedGroup: request.group,
      requestedComponent: request.component,
      unitsRequested: request.units,
      lat: request.lat.toFixed(6),
      lng: request.lng.toFixed(6),
      results: result.results,
      replenishment: result.replenishment ?? null,
    });
    return result;
  });

  return NextResponse.json(response);
}

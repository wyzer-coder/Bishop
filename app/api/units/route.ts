import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registerUnit } from "@/lib/domain/scanner";
import { BLOOD_GROUPS, COMPONENTS, type BloodGroup, type Component } from "@/lib/domain/units";

// POST /api/units — genesis creation for a unit scanned in as an unknown
// tag (the ScanWatcher's "New unit detected" dialog). Clerk-protected like
// the rest of /api/* (middleware.ts only excludes /api/ingest/* and
// /api/allocate).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const { rfidUid, bloodGroup, component, donorRef, collectedAt, facilityId, deviceId } = body as {
    rfidUid?: string;
    bloodGroup?: string;
    component?: string;
    donorRef?: string;
    collectedAt?: string;
    facilityId?: string;
    deviceId?: string | null;
  };

  if (
    !rfidUid ||
    !bloodGroup ||
    !component ||
    !donorRef ||
    !collectedAt ||
    !facilityId ||
    !BLOOD_GROUPS.includes(bloodGroup as BloodGroup) ||
    !COMPONENTS.includes(component as Component)
  ) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const collectedAtDate = new Date(collectedAt);
  if (Number.isNaN(collectedAtDate.getTime())) {
    return NextResponse.json({ error: "INVALID_COLLECTED_AT" }, { status: 400 });
  }

  try {
    const unit = await db.transaction((tx) =>
      registerUnit(tx, {
        rfidUid,
        bloodGroup: bloodGroup as BloodGroup,
        component: component as Component,
        donorRef,
        collectedAt: collectedAtDate,
        facilityId,
        deviceId: deviceId ?? null,
      }),
    );
    return NextResponse.json({ unit }, { status: 201 });
  } catch (err) {
    // Postgres unique_violation on rfid_uid — the tag was registered by
    // someone else between the scan and this submit.
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json({ error: "RFID_ALREADY_REGISTERED" }, { status: 409 });
    }
    throw err;
  }
}

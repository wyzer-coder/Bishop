import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facilities, bloodUnits } from "@/lib/schema";
import { isAtRisk } from "@/lib/domain/units";

// Facility roster with coordinates, for the network map — CLAUDE.md bans a
// real map *provider* by default, but coordinates themselves are just data
// we already have from data.gov.in. Clerk-protected like the rest of /api,
// unlike /api/scan which is deliberately public.
export async function GET() {
  const rows = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      type: facilities.type,
      city: facilities.city,
      lat: facilities.lat,
      lng: facilities.lng,
      beds: facilities.beds,
      ambientC: facilities.ambientC,
    })
    .from(facilities);

  const units = await db
    .select({
      currentFacilityId: bloodUnits.currentFacilityId,
      status: bloodUnits.status,
      component: bloodUnits.component,
      collectedAt: bloodUnits.collectedAt,
    })
    .from(bloodUnits);

  const now = new Date();
  const out = rows.map((f) => {
    const here = units.filter((u) => u.currentFacilityId === f.id && u.status === "AVAILABLE");
    const atRisk = here.filter((u) =>
      isAtRisk({ status: "AVAILABLE", component: u.component, collectedAt: u.collectedAt }, now),
    ).length;
    return {
      id: f.id,
      code: f.code,
      name: f.name,
      type: f.type,
      city: f.city,
      lat: Number(f.lat),
      lng: Number(f.lng),
      beds: f.beds,
      ambientC: f.ambientC !== null ? Number(f.ambientC) : null,
      unitsOnHand: here.length,
      unitsAtRisk: atRisk,
    };
  });

  return NextResponse.json({ facilities: out });
}

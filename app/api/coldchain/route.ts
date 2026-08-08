import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, breaches, custodyEvents, devices, facilities, telemetry } from "@/lib/schema";

// ARCHITECTURE.md section 7 + Phase 5B: devices with their latest reading,
// a 24h multi-series temperature history for the chart, and open breaches
// with the units they affected (for the /coldchain page's breach table,
// each row linking through to /units/[id]).
export async function GET() {
  const facilityRows = await db
    .select({ id: facilities.id, name: facilities.name, city: facilities.city, ambientC: facilities.ambientC })
    .from(facilities);

  const deviceRows = await db
    .select({
      id: devices.id,
      label: devices.label,
      kind: devices.kind,
      facilityId: devices.facilityId,
      facilityName: facilities.name,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .innerJoin(facilities, eq(facilities.id, devices.facilityId));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentTelemetry =
    deviceRows.length === 0
      ? []
      : await db
          .select({
            deviceId: telemetry.deviceId,
            tempC: telemetry.tempC,
            humidity: telemetry.humidity,
            recordedAt: telemetry.recordedAt,
            isBreach: telemetry.isBreach,
          })
          .from(telemetry)
          .where(
            and(
              inArray(telemetry.deviceId, deviceRows.map((d) => d.id)),
              gte(telemetry.recordedAt, since),
            ),
          )
          .orderBy(asc(telemetry.recordedAt));

  const seriesByDevice = new Map<string, { recordedAt: string; tempC: number }[]>();
  const latestByDevice = new Map<string, (typeof recentTelemetry)[number]>();
  for (const r of recentTelemetry) {
    if (!seriesByDevice.has(r.deviceId)) seriesByDevice.set(r.deviceId, []);
    seriesByDevice.get(r.deviceId)!.push({ recordedAt: r.recordedAt.toISOString(), tempC: Number(r.tempC) });
    latestByDevice.set(r.deviceId, r); // last write wins — input is ASC by time
  }

  const devicesOut = deviceRows.map((d) => {
    const latest = latestByDevice.get(d.id);
    return {
      ...d,
      latestReading: latest
        ? {
            tempC: Number(latest.tempC),
            humidity: latest.humidity !== null ? Number(latest.humidity) : null,
            recordedAt: latest.recordedAt.toISOString(),
            isBreach: latest.isBreach,
          }
        : null,
    };
  });

  const series = deviceRows.map((d) => ({
    deviceId: d.id,
    deviceLabel: d.label,
    readings: seriesByDevice.get(d.id) ?? [],
  }));

  const openBreaches = await db.select().from(breaches).orderBy(desc(breaches.startedAt)).limit(20);

  const breachesOut = await Promise.all(
    openBreaches.map(async (b) => {
      const device = deviceRows.find((d) => d.id === b.deviceId);
      // meta.breachId narrows to this exact breach when a device has opened
      // more than one over the demo's lifetime.
      const quarantineEvents = await db
        .select({
          unitId: bloodUnits.id,
          rfidUid: bloodUnits.rfidUid,
          bloodGroup: bloodUnits.bloodGroup,
          component: bloodUnits.component,
          meta: custodyEvents.meta,
        })
        .from(custodyEvents)
        .innerJoin(bloodUnits, eq(bloodUnits.id, custodyEvents.unitId))
        .where(and(eq(custodyEvents.eventType, "QUARANTINED"), eq(custodyEvents.deviceId, b.deviceId)));
      const units = quarantineEvents
        .filter((e) => (e.meta as { breachId?: string })?.breachId === b.id)
        .map(({ unitId, rfidUid, bloodGroup, component }) => ({ unitId, rfidUid, bloodGroup, component }));

      return {
        id: b.id,
        deviceId: b.deviceId,
        deviceLabel: device?.label ?? "Unknown device",
        facilityName: device?.facilityName ?? "Unknown facility",
        startedAt: b.startedAt.toISOString(),
        peakTempC: Number(b.peakTempC),
        unitsAffected: b.unitsAffected,
        note: b.note,
        units,
      };
    }),
  );

  const facilitiesOut = facilityRows.map((f) => ({
    id: f.id,
    name: f.name,
    city: f.city,
    ambientC: f.ambientC !== null ? Number(f.ambientC) : null,
  }));

  return NextResponse.json({ devices: devicesOut, series, breaches: breachesOut, facilities: facilitiesOut });
}

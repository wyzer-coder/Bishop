// ARCHITECTURE.md section 7. Built here in Phase 4 rather than Phase 6:
// the ingest/telemetry contract in section 9 requires breach evaluation on
// every reading, and the /simulator "Simulate cold-chain breach" button is
// pointless without it — Phase 6 will only add the cold-chain *page* on top
// of this, not the domain logic itself.
import { eq, desc } from "drizzle-orm";
import { transitionUnit, type Tx } from "@/lib/domain/units";
import { STORAGE_RANGE, type Component, type UnitStatus } from "@/lib/domain/units";
import { bloodUnits, breaches, telemetry, shipmentUnits } from "@/lib/schema";

const TERMINAL_STATUSES: UnitStatus[] = [
  "TRANSFUSED",
  "QUARANTINED",
  "EXPIRED",
  "DISCARDED",
];

// Strictness ordering when a facility/shipment holds units of several
// components at once: coldest / most failure-sensitive wins. ARCHITECTURE.md
// section 7 says "the strictest component currently held" without defining
// the ordering explicitly — this uses temperature sensitivity as the ranking.
const STRICTNESS_ORDER: Component[] = ["PLASMA", "PRBC", "WHOLE", "PLATELET"];

function strictestRange(components: Component[]) {
  for (const c of STRICTNESS_ORDER) {
    if (components.includes(c)) return STORAGE_RANGE[c];
  }
  // No units on hand yet (e.g. an empty fridge) — default to the common
  // blood-fridge range so telemetry can still be evaluated sensibly.
  return STORAGE_RANGE.PRBC;
}

function isOutOfRange(range: { minC: number; maxC: number | null }, tempC: number) {
  if (tempC < range.minC) return true;
  if (range.maxC !== null && tempC > range.maxC) return true;
  return false;
}

function isSevereBreach(range: { minC: number; maxC: number | null }, tempC: number) {
  if (tempC < range.minC - 5) return true;
  if (range.maxC !== null && tempC > range.maxC + 5) return true;
  return false;
}

export type TelemetryInput = {
  deviceId: string;
  facilityId: string;
  shipmentId: string | null;
  tempC: number;
  humidity: number | null;
  recordedAt: Date;
};

/**
 * Inserts a telemetry row, evaluates the breach rule (three consecutive
 * out-of-range readings from the same device, or one reading more than 5C
 * beyond the limit), and on breach: opens a breaches row, quarantines every
 * affected non-terminal unit, and writes a QUARANTINED custody event per
 * unit. Quarantine is irreversible in this build.
 */
export async function recordTelemetry(tx: Tx, input: TelemetryInput) {
  const heldUnits = input.shipmentId
    ? await tx
        .select({ id: bloodUnits.id, status: bloodUnits.status, component: bloodUnits.component })
        .from(shipmentUnits)
        .innerJoin(bloodUnits, eq(bloodUnits.id, shipmentUnits.unitId))
        .where(eq(shipmentUnits.shipmentId, input.shipmentId))
    : await tx
        .select({ id: bloodUnits.id, status: bloodUnits.status, component: bloodUnits.component })
        .from(bloodUnits)
        .where(eq(bloodUnits.currentFacilityId, input.facilityId));

  const heldComponents = [...new Set(heldUnits.map((u) => u.component as Component))];
  const range = strictestRange(heldComponents);
  const outOfRange = isOutOfRange(range, input.tempC);

  await tx.insert(telemetry).values({
    deviceId: input.deviceId,
    shipmentId: input.shipmentId,
    tempC: input.tempC.toFixed(2),
    humidity: input.humidity !== null ? input.humidity.toFixed(2) : null,
    recordedAt: input.recordedAt,
    isBreach: outOfRange,
  });

  const recent = await tx
    .select({ tempC: telemetry.tempC })
    .from(telemetry)
    .where(eq(telemetry.deviceId, input.deviceId))
    .orderBy(desc(telemetry.recordedAt))
    .limit(3);

  const threeConsecutive =
    recent.length === 3 && recent.every((r) => isOutOfRange(range, Number(r.tempC)));
  const severe = isSevereBreach(range, input.tempC);

  if (!threeConsecutive && !severe) {
    return { breach: false as const };
  }

  const affected = heldUnits.filter(
    (u) => !TERMINAL_STATUSES.includes(u.status as UnitStatus),
  );

  const [breach] = await tx
    .insert(breaches)
    .values({
      deviceId: input.deviceId,
      startedAt: input.recordedAt,
      peakTempC: input.tempC.toFixed(2),
      unitsAffected: affected.length,
      note: severe
        ? `Single reading ${input.tempC}C, severely out of the ${range.minC}..${range.maxC ?? "-∞"}C band`
        : `Three consecutive out-of-range readings on this device`,
    })
    .returning({ id: breaches.id });

  if (affected.length > 0) {
    const reason = `Cold-chain breach: ${input.tempC}C recorded outside the safe range`;
    // transitionUnit is the only way a unit's status may change (CLAUDE.md
    // section 2, rule 6) — one call per unit so each gets its own validated
    // transition and custody_events row, all still inside this transaction.
    for (const u of affected) {
      await transitionUnit(tx, u.id, "QUARANTINED", {
        eventType: "QUARANTINED",
        toFacilityId: input.facilityId,
        deviceId: input.deviceId,
        quarantineReason: reason,
        meta: { breachId: breach.id, tempC: input.tempC },
      });
    }
  }

  return { breach: true as const, breachId: breach.id, unitsAffected: affected.length };
}

import { desc, eq } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NeonTransaction } from "drizzle-orm/neon-serverless";
import * as schema from "@/lib/schema";
import { bloodUnits, custodyEvents } from "@/lib/schema";
import { hashEvent } from "@/lib/domain/hash";

export type Tx = NeonTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type Component = "WHOLE" | "PRBC" | "PLATELET" | "PLASMA";

export type BloodGroup =
  | "A_POS"
  | "A_NEG"
  | "B_POS"
  | "B_NEG"
  | "O_POS"
  | "O_NEG"
  | "AB_POS"
  | "AB_NEG";

export type UnitStatus =
  | "COLLECTED"
  | "TESTING"
  | "AVAILABLE"
  | "RESERVED"
  | "IN_TRANSIT"
  | "ISSUED"
  | "TRANSFUSED"
  | "QUARANTINED"
  | "EXPIRED"
  | "DISCARDED";

export type CustodyEventType =
  | "COLLECTED"
  | "TEST_PASSED"
  | "RELEASED"
  | "SCANNED_IN"
  | "SCANNED_OUT"
  | "TRANSFER_REQUESTED"
  | "TRANSFER_ACCEPTED"
  | "DISPATCHED"
  | "RECEIVED"
  | "ISSUED_TO_PATIENT"
  | "QUARANTINED"
  | "EXPIRED";

export const BLOOD_GROUPS: BloodGroup[] = [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "O_POS",
  "O_NEG",
  "AB_POS",
  "AB_NEG",
];
export const COMPONENTS: Component[] = ["WHOLE", "PRBC", "PLATELET", "PLASMA"];
export const UNIT_STATUSES: UnitStatus[] = [
  "COLLECTED",
  "TESTING",
  "AVAILABLE",
  "RESERVED",
  "IN_TRANSIT",
  "ISSUED",
  "TRANSFUSED",
  "QUARANTINED",
  "EXPIRED",
  "DISCARDED",
];

// ARCHITECTURE.md section 2: component shelf life from collection.
export const SHELF_LIFE_DAYS: Record<Component, number> = {
  WHOLE: 35,
  PRBC: 42,
  PLATELET: 5,
  PLASMA: 365,
};
const HOUR_MS = 60 * 60 * 1000;
const SHELF_LIFE_HOURS: Record<Component, number> = Object.fromEntries(
  Object.entries(SHELF_LIFE_DAYS).map(([k, days]) => [k, days * 24]),
) as Record<Component, number>;

// ARCHITECTURE.md section 2: storage range by component.
export const STORAGE_RANGE: Record<
  Component,
  { minC: number; maxC: number | null }
> = {
  WHOLE: { minC: 2, maxC: 6 },
  PRBC: { minC: 2, maxC: 6 },
  PLATELET: { minC: 20, maxC: 24 },
  PLASMA: { minC: -Infinity, maxC: -25 },
};

// ARCHITECTURE.md section 5: risk window per component.
export const RISK_WINDOW_HOURS: Record<Component, number> = {
  PLATELET: 48,
  WHOLE: 7 * 24,
  PRBC: 10 * 24,
  PLASMA: 30 * 24,
};

// ARCHITECTURE.md section 2: red-cell compatibility matrix, donor -> eligible
// recipients.
export const COMPATIBILITY: Record<BloodGroup, BloodGroup[]> = {
  O_NEG: ["A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG", "AB_POS", "AB_NEG"],
  O_POS: ["O_POS", "A_POS", "B_POS", "AB_POS"],
  A_NEG: ["A_NEG", "A_POS", "AB_NEG", "AB_POS"],
  A_POS: ["A_POS", "AB_POS"],
  B_NEG: ["B_NEG", "B_POS", "AB_NEG", "AB_POS"],
  B_POS: ["B_POS", "AB_POS"],
  AB_NEG: ["AB_NEG", "AB_POS"],
  AB_POS: ["AB_POS"],
};

// ARCHITECTURE.md section 4: the state machine. Declared as an explicit
// adjacency map — any transition not listed here throws. QUARANTINED is
// reachable from any non-terminal state (section 4's stated rule, which is
// broader than what the ASCII diagram there draws) and is terminal in this
// build. EXPIRED is normally derived on read, never written by a sweep (out
// of scope) — but the transition is still declared for the rare case of an
// operator manually retiring an expired unit to DISCARDED.
const TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  COLLECTED: ["TESTING", "QUARANTINED"],
  TESTING: ["AVAILABLE", "QUARANTINED"],
  AVAILABLE: ["RESERVED", "QUARANTINED", "EXPIRED"],
  RESERVED: ["IN_TRANSIT", "QUARANTINED"],
  IN_TRANSIT: ["ISSUED", "QUARANTINED"],
  ISSUED: ["TRANSFUSED", "QUARANTINED"],
  TRANSFUSED: [],
  QUARANTINED: [],
  EXPIRED: ["DISCARDED"],
  DISCARDED: [],
};

export function remainingHours(
  unit: { component: Component; collectedAt: Date },
  now: Date,
): number {
  // Recomputed from collected_at + shelf life every time, per ARCHITECTURE.md
  // section 2 and 4 — never trusted from the stored (denormalized) expires_at
  // column, so there is exactly one place expiry math can drift from.
  const expiresAt = new Date(
    unit.collectedAt.getTime() + SHELF_LIFE_HOURS[unit.component] * HOUR_MS,
  );
  return (expiresAt.getTime() - now.getTime()) / HOUR_MS;
}

export function isAtRisk(
  unit: { status: UnitStatus; component: Component; collectedAt: Date },
  now: Date,
): boolean {
  if (unit.status !== "AVAILABLE") return false;
  const hours = remainingHours(unit, now);
  return hours > 0 && hours <= RISK_WINDOW_HOURS[unit.component];
}

export function isExpired(
  unit: { component: Component; collectedAt: Date },
  now: Date,
): boolean {
  return remainingHours(unit, now) <= 0;
}

export class InvalidTransitionError extends Error {
  constructor(from: UnitStatus, to: UnitStatus) {
    super(
      `Cannot transition a unit from ${from} to ${to}. Allowed from ${from}: ${
        TRANSITIONS[from].join(", ") || "(none — terminal)"
      }`,
    );
    this.name = "InvalidTransitionError";
  }
}

export type TransitionContext = {
  eventType: CustodyEventType;
  toFacilityId?: string;
  actorUserId?: string;
  deviceId?: string;
  meta?: Record<string, unknown>;
  quarantineReason?: string;
  /** Set alongside a TESTING -> AVAILABLE transition. */
  natTested?: boolean;
};

/**
 * The only way a unit's status may ever change. Validates the transition
 * against the declared adjacency map, updates the unit, and writes a
 * custody_events row — all inside the caller's transaction. Throws on an
 * undeclared transition (ARCHITECTURE.md section 4).
 */
export async function transitionUnit(
  tx: Tx,
  unitId: string,
  nextStatus: UnitStatus,
  context: TransitionContext,
) {
  const [unit] = await tx
    .select()
    .from(bloodUnits)
    .where(eq(bloodUnits.id, unitId))
    .for("update");

  if (!unit) {
    throw new Error(`Unit ${unitId} not found`);
  }

  const allowed = TRANSITIONS[unit.status as UnitStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new InvalidTransitionError(unit.status as UnitStatus, nextStatus);
  }

  if (nextStatus === "AVAILABLE" && !(unit.natTested || context.natTested)) {
    throw new Error("AVAILABLE requires nat_tested = true");
  }

  const fromFacilityId = unit.currentFacilityId;
  const toFacilityId = context.toFacilityId ?? fromFacilityId;

  const [updated] = await tx
    .update(bloodUnits)
    .set({
      status: nextStatus,
      currentFacilityId: toFacilityId,
      natTested: context.natTested ?? unit.natTested,
      quarantineReason:
        nextStatus === "QUARANTINED"
          ? (context.quarantineReason ?? "Unspecified")
          : unit.quarantineReason,
      updatedAt: new Date(),
    })
    .where(eq(bloodUnits.id, unitId))
    .returning();

  // Custody hash chain (ARCHITECTURE.md section 5A): computed here, inside
  // the same transaction as the event write, from the previous event's
  // stored hash — never trusted from a client-supplied value.
  const [latest] = await tx
    .select({ eventHash: custodyEvents.eventHash })
    .from(custodyEvents)
    .where(eq(custodyEvents.unitId, unitId))
    .orderBy(desc(custodyEvents.occurredAt))
    .limit(1);
  const prevHash = latest?.eventHash ?? null;
  const occurredAt = new Date();
  const eventHash = hashEvent(prevHash, {
    unitId,
    eventType: context.eventType,
    fromFacilityId,
    toFacilityId,
    occurredAt,
  });

  await tx.insert(custodyEvents).values({
    unitId,
    eventType: context.eventType,
    fromFacilityId,
    toFacilityId,
    actorUserId: context.actorUserId,
    deviceId: context.deviceId,
    meta: context.meta ?? {},
    occurredAt,
    prevHash,
    eventHash,
  });

  return updated;
}

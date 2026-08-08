import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  bigserial,
  bigint,
  date,
  index,
  primaryKey,
  unique,
  check,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────

export const facilityTypeEnum = pgEnum("facility_type", ["HUB", "SPOKE"]);
export const familyLinkStatusEnum = pgEnum("family_link_status", ["PENDING", "VERIFIED"]);

export const userRoleEnum = pgEnum("user_role", [
  "NETWORK_ADMIN",
  "HUB_OPERATOR",
  "HOSPITAL_STAFF",
]);

export const deviceKindEnum = pgEnum("device_kind", [
  "SCANNER",
  "FRIDGE",
  "SHIPPER",
]);

export const bloodGroupEnum = pgEnum("blood_group", [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "O_POS",
  "O_NEG",
  "AB_POS",
  "AB_NEG",
]);

export const componentEnum = pgEnum("component", [
  "WHOLE",
  "PRBC",
  "PLATELET",
  "PLASMA",
]);

export const unitStatusEnum = pgEnum("unit_status", [
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
]);

export const custodyEventTypeEnum = pgEnum("custody_event_type", [
  "COLLECTED",
  "TEST_PASSED",
  "RELEASED",
  "SCANNED_IN",
  "SCANNED_OUT",
  "TRANSFER_REQUESTED",
  "TRANSFER_ACCEPTED",
  "DISPATCHED",
  "RECEIVED",
  "ISSUED_TO_PATIENT",
  "QUARANTINED",
  "EXPIRED",
]);

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "PREPARING",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "SUGGESTED",
  "REQUESTED",
  "ACCEPTED",
  "DECLINED",
  "COMPLETED",
  "CANCELLED",
]);

export const serviceCodeEnum = pgEnum("service_code", [
  "COLD_CHAIN_STORAGE",
  "NAT_TESTING",
  "COMPONENT_PREP",
  "LAST_MILE_LOGISTICS",
  "PLATFORM_SLA",
]);

// ─── Identity and places ────────────────────────────────────────────────

export const facilities = pgTable("facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: facilityTypeEnum("type").notNull(),
  city: text("city").notNull(),
  lat: numeric("lat", { precision: 9, scale: 6 }).notNull(),
  lng: numeric("lng", { precision: 9, scale: 6 }).notNull(),
  beds: integer("beds"),
  // ARCHITECTURE.md section 5B item 7 (optional): current ambient
  // temperature at the facility's coordinates, from Open-Meteo (no API
  // key) at seed time only — never fetched in a request path. Nullable:
  // absent if the fetch failed or hasn't run.
  ambientC: numeric("ambient_c", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  role: userRoleEnum("role").notNull().default("HOSPITAL_STAFF"),
  facilityId: uuid("facility_id").references(() => facilities.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Devices ────────────────────────────────────────────────────────────

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  kind: deviceKindEnum("kind").notNull(),
  facilityId: uuid("facility_id")
    .notNull()
    .references(() => facilities.id),
  deviceKey: text("device_key").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── The unit ───────────────────────────────────────────────────────────

export const bloodUnits = pgTable(
  "blood_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfidUid: text("rfid_uid").notNull().unique(),
    donorRef: text("donor_ref").notNull(),
    bloodGroup: bloodGroupEnum("blood_group").notNull(),
    component: componentEnum("component").notNull(),
    status: unitStatusEnum("status").notNull().default("COLLECTED"),
    natTested: boolean("nat_tested").notNull().default(false),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    currentFacilityId: uuid("current_facility_id")
      .notNull()
      .references(() => facilities.id),
    originFacilityId: uuid("origin_facility_id")
      .notNull()
      .references(() => facilities.id),
    quarantineReason: text("quarantine_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("blood_units_facility_status_idx").on(
      table.currentFacilityId,
      table.status,
    ),
    index("blood_units_expires_at_idx").on(table.expiresAt),
  ],
);

// ─── Chain of custody: the trust layer ──────────────────────────────────

export const custodyEvents = pgTable(
  "custody_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => bloodUnits.id),
    eventType: custodyEventTypeEnum("event_type").notNull(),
    fromFacilityId: uuid("from_facility_id").references(() => facilities.id),
    toFacilityId: uuid("to_facility_id").references(() => facilities.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    meta: jsonb("meta").notNull().default({}),
    // ARCHITECTURE.md section 5A: the custody hash chain. Nullable because
    // pre-protocol-layer rows have none; verifyChain treats a missing hash
    // as a break. Computed inside the same transaction as the insert —
    // never backfilled from a trusted client value.
    eventHash: text("event_hash"),
    prevHash: text("prev_hash"),
  },
  (table) => [
    index("custody_events_unit_occurred_idx").on(
      table.unitId,
      table.occurredAt,
    ),
  ],
);

// ─── Cold chain ─────────────────────────────────────────────────────────
// shipments is declared before telemetry: telemetry.shipment_id references it.

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromFacilityId: uuid("from_facility_id")
    .notNull()
    .references(() => facilities.id),
  toFacilityId: uuid("to_facility_id")
    .notNull()
    .references(() => facilities.id),
  status: shipmentStatusEnum("status").notNull().default("PREPARING"),
  deviceId: uuid("device_id").references(() => devices.id),
  departedAt: timestamp("departed_at", { withTimezone: true }),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const shipmentUnits = pgTable(
  "shipment_units",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => bloodUnits.id),
  },
  (table) => [
    primaryKey({ columns: [table.shipmentId, table.unitId] }),
  ],
);

export const telemetry = pgTable(
  "telemetry",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    tempC: numeric("temp_c", { precision: 5, scale: 2 }).notNull(),
    humidity: numeric("humidity", { precision: 5, scale: 2 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isBreach: boolean("is_breach").notNull().default(false),
  },
  (table) => [
    index("telemetry_device_recorded_idx").on(
      table.deviceId,
      table.recordedAt.desc(),
    ),
  ],
);

export const breaches = pgTable("breaches", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  peakTempC: numeric("peak_temp_c", { precision: 5, scale: 2 }).notNull(),
  unitsAffected: integer("units_affected").notNull().default(0),
  note: text("note"),
});

// ─── The Blood Credit market ────────────────────────────────────────────

export const transfers = pgTable("transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id")
    .notNull()
    .references(() => bloodUnits.id),
  offeringFacilityId: uuid("offering_facility_id")
    .notNull()
    .references(() => facilities.id),
  receivingFacilityId: uuid("receiving_facility_id")
    .notNull()
    .references(() => facilities.id),
  status: transferStatusEnum("status").notNull().default("SUGGESTED"),
  credits: integer("credits").notNull().default(1),
  reason: text("reason").notNull(),
  score: numeric("score", { precision: 6, scale: 2 }).notNull(),
  shipmentId: uuid("shipment_id").references(() => shipments.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// Double entry. Two rows per settled transfer. SUM(delta) is always 0.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    transferId: uuid("transfer_id").references(() => transfers.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("credit_ledger_facility_created_idx").on(
      table.facilityId,
      table.createdAt.desc(),
    ),
  ],
);

// ─── Service revenue. Never blood. ──────────────────────────────────────

export const billingLines = pgTable("billing_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityId: uuid("facility_id")
    .notNull()
    .references(() => facilities.id),
  unitId: uuid("unit_id").references(() => bloodUnits.id),
  code: serviceCodeEnum("code").notNull(),
  description: text("description").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const slaContracts = pgTable("sla_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityId: uuid("facility_id")
    .notNull()
    .references(() => facilities.id),
  tier: text("tier").notNull(),
  annualFeePaise: bigint("annual_fee_paise", { mode: "number" }).notNull(),
  responseMinutes: integer("response_minutes").notNull(),
  startedOn: date("started_on").notNull(),
});

export const demandSignals = pgTable(
  "demand_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    bloodGroup: bloodGroupEnum("blood_group").notNull(),
    component: componentEnum("component").notNull(),
    day: date("day").notNull(),
    unitsUsed: integer("units_used").notNull(),
  },
  (table) => [
    index("demand_signals_facility_group_component_day_idx").on(
      table.facilityId,
      table.bloodGroup,
      table.component,
      table.day.desc(),
    ),
  ],
);

// ─── Protocol layer (ARCHITECTURE.md section 5A) ────────────────────────

export const reserveFloors = pgTable(
  "reserve_floors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    bloodGroup: bloodGroupEnum("blood_group").notNull(),
    component: componentEnum("component").notNull(),
    minUnits: integer("min_units").notNull(),
  },
  (table) => [
    unique("reserve_floors_facility_group_component_key").on(
      table.facilityId,
      table.bloodGroup,
      table.component,
    ),
  ],
);

// Not named in section 5A's schema list, but required to make
// GET /api/protocol/log and the /protocol console real rather than stubbed,
// and for scripts/check-invariants.ts to assert no logged allocation ever
// drew a reserved unit. One row per POST /api/allocate call.
export const allocationLog = pgTable("allocation_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  priority: text("priority").notNull(), // 'ROUTINE' | 'URGENT' | 'EMERGENCY'
  requestedGroup: bloodGroupEnum("requested_group").notNull(),
  requestedComponent: componentEnum("requested_component").notNull(),
  unitsRequested: integer("units_requested").notNull(),
  lat: numeric("lat", { precision: 9, scale: 6 }).notNull(),
  lng: numeric("lng", { precision: 9, scale: 6 }).notNull(),
  results: jsonb("results").notNull().default([]),
  replenishment: jsonb("replenishment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Scan-driven registration and the movable scanner ──────────────────
// Additive. Every physical tap — known tag or not — writes exactly one row
// here, which is what the ScanWatcher polls to drive the "new unit" dialog
// or a toast. All actual unit movement still goes through transitionUnit()
// (lib/domain/units.ts) and its custody-event hash chain; this table is a
// log of scans, not a second source of truth for unit state.
export const scanEvents = pgTable(
  "scan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfidUid: text("rfid_uid").notNull(),
    deviceId: uuid("device_id").references(() => devices.id),
    facilityId: uuid("facility_id").references(() => facilities.id),
    // Deliberately a plain text column, not a pgEnum: UNKNOWN_TAG | MOVED_OUT
    // | MOVED_IN | NO_CHANGE | DUPLICATE_IGNORED.
    outcome: text("outcome").notNull(),
    unitId: uuid("unit_id").references(() => bloodUnits.id),
    detail: text("detail"),
    handled: boolean("handled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("scan_events_created_at_idx").on(table.createdAt.desc())],
);

// Singleton row (id is always 1) tracking where the one physical scanner
// currently is. Moving it changes which facility the very next scan acts
// on — lets a single demo scanner stand in for every facility's device.
export const scannerState = pgTable(
  "scanner_state",
  {
    id: integer("id").primaryKey().default(1),
    currentFacilityId: uuid("current_facility_id")
      .notNull()
      .references(() => facilities.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("scanner_state_singleton", sql`${table.id} = 1`)],
);

// ─── Personal / family blood credits ───────────────────────────────────
// A separate, deliberately additive layer, NOT part of the institutional
// credit_ledger above. Donating gives a person +1 credit; a verified family
// member can redeem it for a same-value unit instead of searching for a
// donor. No rupee value anywhere, non-transferable outside a verified link,
// no cash-out. Distinct from the facility-to-facility ledger, which stays
// exactly as CLAUDE.md defines it.

export const donors = pgTable("donors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  // Set when a donor is registered from a physical card tap (the scan
  // ingest route's donor lookup below) — nullable because a donor can also
  // be registered from the Family Credits page with no card involved.
  rfidUid: text("rfid_uid").unique(),
  facilityId: uuid("facility_id").references(() => facilities.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const donorFamilyMembers = pgTable("donor_family_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  donorId: uuid("donor_id")
    .notNull()
    .references(() => donors.id),
  memberName: text("member_name").notNull(),
  memberPhone: text("member_phone").notNull(),
  status: familyLinkStatusEnum("status").notNull().default("PENDING"),
  verificationCode: text("verification_code").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Double-entry-adjacent but not double-entry: a personal balance, not a
// network ledger. +1 per donation, -1 per redemption, balanceAfter denormalized
// the same way credit_ledger does for cheap history reads.
export const donorCreditLedger = pgTable("donor_credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  donorId: uuid("donor_id")
    .notNull()
    .references(() => donors.id),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  unitId: uuid("unit_id").references(() => bloodUnits.id),
  familyMemberId: uuid("family_member_id").references(() => donorFamilyMembers.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

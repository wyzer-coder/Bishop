# ARCHITECTURE.md — BishopOS

Technical specification. `CLAUDE.md` defines the rules; this file defines the system. Implement exactly what is here. Where this document is silent, choose the simplest option that satisfies `CLAUDE.md`.

---

## 1. System overview

```
   PHYSICAL WORLD                    BISHOPOS (Vercel)                 DATA
   ─────────────                     ─────────────────                 ────

   ESP32 + MFRC522                                                 ┌──────────────┐
   (RFID scanner) ──── HTTPS POST ──► /api/ingest/scan ─────────►  │              │
                                                                   │    Neon      │
   ESP32 + temp sensor                                             │   Postgres   │
   (fridge / shipper) ─ HTTPS POST ─► /api/ingest/telemetry ────►  │              │
                                                                   │  (Drizzle)   │
   /simulator page ──── same payloads ─────────┘                   │              │
   (hardware-free fallback)                                        └──────┬───────┘
                                                                          │
                                       ┌──────────────────────────────────┘
                                       ▼
                              /lib/domain  (pure functions)
                       units · matching · credits · coldchain · billing
                                       │
                                       ▼
                        React Server Components + TanStack Query
                             (poll every 4000 ms, no sockets)
                                       │
                                       ▼
                        Dashboard · Inventory · Transfers · Credits
                             Cold chain · Billing · Unit detail
                                       │
                                   Clerk auth
                          (role + facility resolved per request)
```

**One Next.js application. No separate backend, no broker, no worker.** All derived state (at-risk status, forecasts, matches, balances) is computed on read. There are no scheduled jobs.

---

## 2. Domain model

### Facilities

Two types. A **HUB** performs collection, testing and component preparation. A **SPOKE** is a partner hospital with a smart fridge. Transfers flow hub→spoke, spoke→spoke, and spoke→hub.

### The blood unit

The atomic object. Identified by the **RFID tag UID** physically affixed to the bag. The UID is the primary business key: scanning a tag is how the physical world addresses the database.

### Components and shelf life

| Component | Code | Shelf life from collection | Storage range |
|---|---|---|---|
| Whole blood | `WHOLE` | 35 days | 2 to 6 °C |
| Packed red cells | `PRBC` | 42 days | 2 to 6 °C |
| Platelets | `PLATELET` | 5 days | 20 to 24 °C |
| Fresh frozen plasma | `PLASMA` | 365 days | at or below −25 °C |

These constants live in `lib/domain/units.ts` as a single exported map. Expiry is always `collected_at + shelfLifeDays`, computed, never hand-set.

### Blood groups

`A+ A- B+ B- O+ O- AB+ AB-`. Compatibility matrix for red cells (donor → eligible recipients) lives in `lib/domain/units.ts` and is used by the matching engine:

```
O-  → everyone
O+  → O+ A+ B+ AB+
A-  → A- A+ AB- AB+
A+  → A+ AB+
B-  → B- B+ AB- AB+
B+  → B+ AB+
AB- → AB- AB+
AB+ → AB+
```

---

## 3. Database schema

Neon Postgres. Drizzle definitions in `lib/schema.ts`. Reference DDL:

```sql
-- ─── Identity and places ────────────────────────────────────────────────

CREATE TYPE facility_type AS ENUM ('HUB','SPOKE');
CREATE TABLE facilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,          -- 'HUB-CHN-01', 'SPK-CHN-APOLLO'
  name          text NOT NULL,
  type          facility_type NOT NULL,
  city          text NOT NULL,
  lat           numeric(9,6) NOT NULL,
  lng           numeric(9,6) NOT NULL,
  beds          integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('NETWORK_ADMIN','HUB_OPERATOR','HOSPITAL_STAFF');
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text UNIQUE NOT NULL,
  email         text NOT NULL,
  full_name     text,
  role          user_role NOT NULL DEFAULT 'HOSPITAL_STAFF',
  facility_id   uuid REFERENCES facilities(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Devices ────────────────────────────────────────────────────────────

CREATE TYPE device_kind AS ENUM ('SCANNER','FRIDGE','SHIPPER');
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  kind          device_kind NOT NULL,
  facility_id   uuid NOT NULL REFERENCES facilities(id),
  device_key    text UNIQUE NOT NULL,          -- shared secret, sent as X-Device-Key
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── The unit ───────────────────────────────────────────────────────────

CREATE TYPE blood_group AS ENUM ('A_POS','A_NEG','B_POS','B_NEG','O_POS','O_NEG','AB_POS','AB_NEG');
CREATE TYPE component   AS ENUM ('WHOLE','PRBC','PLATELET','PLASMA');
CREATE TYPE unit_status AS ENUM (
  'COLLECTED','TESTING','AVAILABLE','RESERVED',
  'IN_TRANSIT','ISSUED','TRANSFUSED','QUARANTINED','EXPIRED','DISCARDED'
);

CREATE TABLE blood_units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfid_uid            text UNIQUE NOT NULL,     -- e.g. '04A3B2C1'
  donor_ref           text NOT NULL,            -- pseudonymous, never PII
  blood_group         blood_group NOT NULL,
  component           component NOT NULL,
  status              unit_status NOT NULL DEFAULT 'COLLECTED',
  nat_tested          boolean NOT NULL DEFAULT false,
  collected_at        timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,     -- derived, written once at creation
  current_facility_id uuid NOT NULL REFERENCES facilities(id),
  origin_facility_id  uuid NOT NULL REFERENCES facilities(id),
  quarantine_reason   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON blood_units (current_facility_id, status);
CREATE INDEX ON blood_units (expires_at);

-- ─── Chain of custody: the trust layer ──────────────────────────────────

CREATE TYPE custody_event_type AS ENUM (
  'COLLECTED','TEST_PASSED','RELEASED','SCANNED_IN','SCANNED_OUT',
  'TRANSFER_REQUESTED','TRANSFER_ACCEPTED','DISPATCHED','RECEIVED',
  'ISSUED_TO_PATIENT','QUARANTINED','EXPIRED'
);
CREATE TABLE custody_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES blood_units(id),
  event_type     custody_event_type NOT NULL,
  from_facility_id uuid REFERENCES facilities(id),
  to_facility_id   uuid REFERENCES facilities(id),
  actor_user_id  uuid REFERENCES users(id),
  device_id      uuid REFERENCES devices(id),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON custody_events (unit_id, occurred_at);

-- ─── Cold chain ─────────────────────────────────────────────────────────

CREATE TABLE telemetry (
  id           bigserial PRIMARY KEY,
  device_id    uuid NOT NULL REFERENCES devices(id),
  shipment_id  uuid REFERENCES shipments(id),
  temp_c       numeric(5,2) NOT NULL,
  humidity     numeric(5,2),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  is_breach    boolean NOT NULL DEFAULT false
);
CREATE INDEX ON telemetry (device_id, recorded_at DESC);

CREATE TABLE breaches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES devices(id),
  started_at    timestamptz NOT NULL,
  peak_temp_c   numeric(5,2) NOT NULL,
  units_affected integer NOT NULL DEFAULT 0,
  note          text
);

-- ─── Movement ───────────────────────────────────────────────────────────

CREATE TYPE shipment_status AS ENUM ('PREPARING','IN_TRANSIT','DELIVERED','FAILED');
CREATE TABLE shipments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_facility_id  uuid NOT NULL REFERENCES facilities(id),
  to_facility_id    uuid NOT NULL REFERENCES facilities(id),
  status            shipment_status NOT NULL DEFAULT 'PREPARING',
  device_id         uuid REFERENCES devices(id),   -- the shipper logger
  departed_at       timestamptz,
  arrived_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shipment_units (
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  unit_id     uuid NOT NULL REFERENCES blood_units(id),
  PRIMARY KEY (shipment_id, unit_id)
);

-- ─── The Blood Credit market ────────────────────────────────────────────

CREATE TYPE transfer_status AS ENUM ('SUGGESTED','REQUESTED','ACCEPTED','DECLINED','COMPLETED','CANCELLED');
CREATE TABLE transfers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid NOT NULL REFERENCES blood_units(id),
  offering_facility_id  uuid NOT NULL REFERENCES facilities(id),
  receiving_facility_id uuid NOT NULL REFERENCES facilities(id),
  status                transfer_status NOT NULL DEFAULT 'SUGGESTED',
  credits               integer NOT NULL DEFAULT 1,
  reason                text NOT NULL,           -- human-readable match rationale
  score                 numeric(6,2) NOT NULL,
  shipment_id           uuid REFERENCES shipments(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz
);

-- Double entry. Two rows per settled transfer. SUM(delta) is always 0.
CREATE TABLE credit_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   uuid NOT NULL REFERENCES facilities(id),
  delta         integer NOT NULL,               -- +1 offering, -1 receiving
  balance_after integer NOT NULL,
  transfer_id   uuid REFERENCES transfers(id),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON credit_ledger (facility_id, created_at DESC);

-- ─── Service revenue. Never blood. ──────────────────────────────────────

CREATE TYPE service_code AS ENUM (
  'COLD_CHAIN_STORAGE','NAT_TESTING','COMPONENT_PREP','LAST_MILE_LOGISTICS','PLATFORM_SLA'
);
CREATE TABLE billing_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   uuid NOT NULL REFERENCES facilities(id),
  unit_id       uuid REFERENCES blood_units(id),   -- what the service was performed on
  code          service_code NOT NULL,
  description   text NOT NULL,
  amount_paise  integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sla_contracts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id          uuid NOT NULL REFERENCES facilities(id),
  tier                 text NOT NULL,             -- 'BRONZE','SILVER','GOLD'
  annual_fee_paise     bigint NOT NULL,
  response_minutes     integer NOT NULL,          -- guaranteed availability SLA
  started_on           date NOT NULL
);

CREATE TABLE demand_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  uuid NOT NULL REFERENCES facilities(id),
  blood_group  blood_group NOT NULL,
  component    component NOT NULL,
  day          date NOT NULL,
  units_used   integer NOT NULL
);
CREATE INDEX ON demand_signals (facility_id, blood_group, component, day DESC);
```

> Note the forward reference: create `shipments` before `telemetry`, or add the FK afterwards. Drizzle handles this; be aware when writing raw SQL.

---

## 4. Unit state machine

```
COLLECTED ──► TESTING ──► AVAILABLE ──► RESERVED ──► IN_TRANSIT ──► ISSUED ──► TRANSFUSED
                             │              │            │
                             └──────────────┴────────────┴──► QUARANTINED  (terminal)
                             │
                             └──► EXPIRED ──► DISCARDED  (terminal)
```

Rules enforced in `lib/domain/units.ts`:

- Transitions are declared as an explicit adjacency map. Any transition not in the map throws.
- `AVAILABLE` requires `nat_tested = true`.
- `QUARANTINED` is reachable from any non-terminal state and is terminal in this build.
- `EXPIRED` is **derived on read** when `now() > expires_at`; a unit is displayed as expired without a write. A nightly sweep is out of scope.
- Every successful transition writes a `custody_events` row inside the same database transaction. This is the single most important line in this document.

---

## 5. Matching engine

`lib/domain/matching.ts`. Pure function, no I/O beyond a passed-in transaction. Runs on every request to `/api/match` and to the transfers page.

### Step 1: identify at-risk units

A unit is at risk when it is `AVAILABLE` and its remaining shelf life has fallen below the component's risk window:

| Component | Risk window |
|---|---|
| `PLATELET` | 48 hours |
| `WHOLE` | 7 days |
| `PRBC` | 10 days |
| `PLASMA` | 30 days |

### Step 2: forecast demand per candidate facility

Moving average over the last 14 days of `demand_signals` for that facility, blood group and component. Projected consumption over the risk window is `dailyAverage × riskWindowDays`. Deliberately simple; explain it as such.

### Step 3: score each (at-risk unit, candidate facility) pair

```
shortage = max(0, projectedDemand − currentCompatibleStockAtCandidate)

score =  (shortage        × 40)     // will they actually use it
       + (urgency         × 30)     // 1 − (hoursRemaining / riskWindowHours)
       − (distanceKm      × 0.5)    // haversine, transport cost proxy
       + (creditNeed      × 10)     // candidate has a negative balance
       + (exactGroupMatch ? 15 : 0) // prefer exact over merely compatible
```

Discard any pair where `shortage = 0` or `distanceKm > 150`. Return the top three per unit, each with a `reason` string generated from the dominant term, for example:

> "Apollo Vanagaram projects a 4-unit O+ PRBC shortfall in 6 days. This unit expires in 4 days, 11 km away."

Distance uses the haversine formula against the stored lat/lng. **No map API.**

### Step 4: surface, never auto-execute

The engine only creates `transfers` rows with status `SUGGESTED`. A human accepts. This is a deliberate product decision and a good answer to the "what if the algorithm is wrong" question.

---

## 6. Blood Credit ledger

`lib/domain/credits.ts`.

- `settleTransfer(tx, transferId)` runs inside one transaction and:
  1. Locks both facilities' latest ledger rows.
  2. Writes `+credits` for the offering facility and `−credits` for the receiving facility, each with the recomputed `balance_after`.
  3. Sets the transfer to `ACCEPTED` and creates a `shipments` row plus a `TRANSFER_ACCEPTED` custody event.
- **Overdraft limit: −5.** A facility at −5 cannot receive further transfers until it offers one. This makes the market reciprocal rather than extractive, and it is a good thing to say out loud in the pitch.
- Credits never expire, never convert to currency, and never leave the network. There is no `value_inr` field and there must never be one.
- **Invariant test** (`scripts/check-invariants.ts`, run before the demo): `SELECT SUM(delta) FROM credit_ledger` returns `0`.

---

## 7. Cold chain

`lib/domain/coldchain.ts`.

Storage ranges are as tabulated in section 2. A reading is out of range if it falls outside the range for the strictest component currently held by that device's facility or shipment.

**Breach rule:** three consecutive out-of-range readings from the same device, or any single reading more than 5 °C beyond the limit, opens a breach.

On breach:
1. Insert a `breaches` row.
2. Set every non-terminal unit at that fridge's facility, or on that shipment, to `QUARANTINED` with `quarantine_reason`.
3. Write a `QUARANTINED` custody event per unit.
4. Update `breaches.units_affected`.

Quarantine is irreversible in this build. Say so; it demonstrates that the trust layer has teeth.

---

## 8. Billing

`lib/domain/billing.ts`. Service lines are generated when a unit reaches a milestone. Indicative tariffs, stored in paise:

| Trigger | Code | Amount |
|---|---|---|
| Unit received at a spoke fridge | `COLD_CHAIN_STORAGE` | ₹250 |
| `nat_tested` set true at hub | `NAT_TESTING` | ₹650 |
| Component produced from whole blood | `COMPONENT_PREP` | ₹300 |
| Shipment delivered | `LAST_MILE_LOGISTICS` | ₹80 |
| Monthly, per contracted spoke | `PLATFORM_SLA` | per contract tier |

**Hard rule, enforced by a code comment at the top of the file and by review:** there is no service code for the blood itself, and no billing line may be created on a transfer of the biological product. The billing page carries a visible footnote: *"Blood is never invoiced. All charges are for cold chain, testing, logistics and platform services."*

---

## 9. API contracts

### Device ingest (unauthenticated by Clerk, authenticated by device key)

```http
POST /api/ingest/scan
X-Device-Key: <devices.device_key>
Content-Type: application/json

{ "rfidUid": "04A3B2C1", "action": "IN" | "OUT", "ts": "2026-08-08T09:12:00Z" }
```

Behaviour: resolve device → facility. If `rfidUid` is unknown, return `404` with `{ error: "UNKNOWN_TAG" }` (the UI shows this as an alert, which is itself a good demo beat). If known, write the custody event, move the unit's `current_facility_id` and status per the state machine, generate any billing line, update `devices.last_seen_at`. Respond `200` with the unit summary.

```http
POST /api/ingest/telemetry
X-Device-Key: <devices.device_key>

{ "tempC": 8.4, "humidity": 52.1, "shipmentId": null, "ts": "..." }
```

Behaviour: insert telemetry, evaluate the breach rule, quarantine if triggered, return `{ ok: true, breach: boolean }`.

Both routes must be **idempotent-tolerant**: a duplicate scan within 5 seconds is ignored rather than erroring. Loose wiring on a breadboard will send doubles.

### Application routes (Clerk-protected)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/inventory` | Units, filterable by facility, group, component, status |
| `GET` | `/api/units/[id]` | Unit with custody timeline and telemetry series |
| `GET` | `/api/match` | Live at-risk units with ranked suggestions |
| `POST` | `/api/transfers` | Create a `REQUESTED` transfer |
| `POST` | `/api/transfers/[id]/accept` | Settle credits, create shipment |
| `POST` | `/api/transfers/[id]/decline` | |
| `GET` | `/api/credits` | Balances and ledger, paginated |
| `GET` | `/api/coldchain` | Devices, latest readings, open breaches |
| `GET` | `/api/billing` | Service lines with totals |
| `GET` | `/api/stats` | Dashboard aggregates |

All GETs are polled at 4000 ms by TanStack Query. Keep them cheap: index as specified and avoid N+1.

---

## 10. Firmware

`firmware/bishop_node/bishop_node.ino`. One sketch, a compile-time flag selects the role.

**Hardware mapping (ESP32):**

| Component | Pins |
|---|---|
| MFRC522 RFID | SDA/SS `21`, SCK `18`, MOSI `23`, MISO `19`, RST `22` |
| Temperature (DS18B20 one-wire, or DHT22) | data `4` |
| Ultrasonic HC-SR04 (fridge slot occupancy) | trig `5`, echo `17` |
| Status LED | `2` |

**Behaviour:**
- Connect to Wi-Fi, retry with backoff, blink the LED on failure.
- `SCANNER` role: on a new tag UID, POST to `/api/ingest/scan`. Debounce the same UID for 3 seconds.
- `FRIDGE` role: POST temperature every 5 seconds. Optionally include the ultrasonic distance reading as `meta.slotOccupied` when below a threshold.
- Send `X-Device-Key` on every request. Keys are compiled in for the demo; note in the README that production would provision per-device certificates.
- Use `WiFiClientSecure` with `setInsecure()` for the demo. Note it as a known shortcut rather than hiding it.

**The ultrasonic sensor's demo role:** mounted at a fridge slot, it detects whether a bag is physically present. Pair it with the RFID reading to demonstrate that the system knows both *what* is in the fridge and *that it is still there*. This is optional. Build it only if the software is complete.

---

## 11. Seed data and the demo script

### Seed (`scripts/seed.ts`, deterministic, fixed random seed)

- 1 hub: `HUB-CHN-01`, Chennai.
- 4 spokes across Chennai with realistic coordinates and bed counts.
- 6 devices: 1 scanner and 1 fridge at the hub, 1 fridge each at three spokes, 1 shipper logger.
- 120 blood units spread across groups and components, with `collected_at` values chosen so that:
  - about 8 units sit inside their risk window at demo time,
  - at least 2 are platelets expiring within 36 hours (the most dramatic countdown),
  - one spoke is visibly short of `O_POS` `PRBC`.
- 90 days of `demand_signals` per spoke with a weekday pattern, so the moving average is non-trivial.
- Opening credit balances: hub `+6`, two spokes `0`, one spoke `−3` (so the "reciprocity" story has a live example).
- Six weeks of billing lines so the billing page is not empty.

Seed must be re-runnable: truncate then insert.

### The ninety-second demo

1. **Dashboard.** Network of five facilities. 120 units. Eight flagged at risk. One spoke short on O+. *"Today every one of these banks is blind to the others."*
2. **Transfers.** Open the platelet unit expiring in 31 hours. Read the generated reason aloud. Accept.
3. **Credits.** Both balances move. Point at the ledger: two rows, equal and opposite. *"No money changed hands. That is what makes this legal."*
4. **Scan the tag** on the physical bag with the ESP32. The unit detail page updates within one poll. Custody timeline gains a row with the device name.
5. **Trigger the breach.** Warm the sensor, or click "Simulate breach" on `/simulator`. Units on that shipment turn red and quarantine. *"A broken cold chain voids the unit automatically. That is why the receiving hospital can trust a bag that sat in someone else's fridge."*
6. **Billing.** Scroll the service lines. *"Cold chain, testing, logistics, platform. There is no line here for blood, and there never will be."*

Close on the credit ledger, not the dashboard.

---

## 12. Environment

```bash
DATABASE_URL=                          # Neon pooled connection string
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
DEMO_DEVICE_KEY=                       # convenience key used by /simulator
```

Clerk middleware protects everything under `/(app)`. `/api/ingest/*` must be **excluded** from Clerk middleware; devices authenticate with `X-Device-Key` only.

On first sign-in, a user row is created and assigned a facility. For the demo, map by email domain in seed data and default unmapped users to `NETWORK_ADMIN` so any judge who signs up sees the full network.

---

## 13. Build order and time budget (18 hours)

| Window | Deliverable | Gate to pass before moving on |
|---|---|---|
| 0:00–0:45 | Repo, Next.js, Tailwind, shadcn, Clerk, Neon, Drizzle, deploy an empty page to Vercel | Public URL loads and sign-in works |
| 0:45–2:00 | `lib/schema.ts` complete, migrations pushed, `seed.ts` runs | Data visible in the Neon console |
| 2:00–3:30 | `lib/domain/units.ts`: state machine, expiry, compatibility. `/api/inventory`, inventory page | Table renders 120 seeded units with countdowns |
| 3:30–5:00 | Custody events, `/api/ingest/scan`, `/simulator` virtual scanner, unit detail timeline | A simulated scan appears on screen within one poll |
| 5:00–7:00 | `matching.ts`, `/api/match`, transfers page with reasons | Eight at-risk units with ranked, readable suggestions |
| 7:00–8:30 | `credits.ts`, accept and decline, credits page, invariant check | Accept moves two balances; `SUM(delta) = 0` |
| 8:30–10:00 | `coldchain.ts`, telemetry ingest, breach and quarantine, cold-chain page with a Recharts series | Simulated bad reading quarantines units live |
| 10:00–11:00 | `billing.ts`, billing page with the footnote | Service lines populate as units move |
| 11:00–12:30 | Dashboard: aggregates, at-risk count, credit summary, wastage-averted metric | The screen reads in four seconds |
| 12:30–14:30 | **Firmware.** Scanner first, then fridge, then ultrasonic if time | Physical tag scan hits production and updates the UI |
| 14:30–16:00 | Polish to the design language, empty states, error toasts, re-seed, deploy | Demo runs end to end on the public URL from a phone |
| 16:00–18:00 | **Code freeze.** Rehearse three times. Prepare answers. Buffer. | Three clean run-throughs |

**Two people in parallel** is the practical maximum. Split at 3:30: one takes matching, credits and transfers; the other takes cold chain, billing and dashboard. They touch different files under `lib/domain` and different route folders, so merges stay clean. Firmware is a third track that can start any time after the ingest contract is fixed at 5:00.

---

## 14. Known shortcuts, stated honestly

Judges respect a team that names its own gaps before they do.

- Device keys are compiled into the firmware and sent over TLS with certificate verification disabled. Production would use per-device provisioning and mutual TLS.
- Expiry is evaluated on read rather than by a scheduled sweep.
- The forecast is a 14-day moving average, not a model. It is sufficient to rank shortages and is deliberately legible.
- Distance is straight-line haversine, not routed road distance.
- One region, one currency, no multi-tenancy isolation beyond `facility_id` scoping.
- The CDSCO tariff position and the plasma fractionation revenue line are commercial assumptions carried over from the pitch deck. They are not validated here.
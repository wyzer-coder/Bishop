# CLAUDE.md — BishopOS

Operating rules for any AI agent working in this repository. Read this file completely before writing code. Re-read it whenever you start a new task.

---

## 1. What we are building

**BishopOS** is the software platform behind **Bishop**, a Section 8 "Vascular Utility" that operates India's collection-to-hospital blood supply chain as a funded service rather than a charity.

The product being built in this repository is a **working demo of the operating system for a blood-supply network**: real-time inventory across facilities, RFID-verified chain of custody, IoT cold-chain monitoring, an expiry-driven redistribution engine, a non-monetary Blood Credit ledger, and a service-fee billing meter.

This is a **hackathon build with a hard 18-hour ceiling**. Every decision in this document optimizes for a working, demonstrable system over a complete one.

### The single idea the demo must prove

> Blood is a perishable, partially-substitutable asset that moves between institutions which do not trust each other. No inventory system can model that, which is why every existing platform can only answer "does facility X have O+?" BishopOS gives every unit of blood a routable address and a time-to-live, and exposes one call that returns the single unit, anywhere in the network, whose allocation costs the network least. Blood has never had an address. We gave it one.

If a feature does not help a judge understand or believe that sentence, it does not get built.

---

## 2A. The protocol

BishopOS is framed as a network protocol, not an inventory app. The mapping:

| Networking concept | Bishop equivalent |
|---|---|
| MAC address | RFID UID — permanent, physical, burned into the tag |
| IP address | BUA — routable, and it changes when the unit changes hands |
| TTL | Shelf life remaining |
| Checksum | The custody hash chain. A broken chain drops the packet |
| QoS | Priority class |
| Reserved address space | The emergency reserve floor |
| Routing table | The allocation solver |

---

## 2. Non-negotiable invariants

These are correctness requirements, not preferences. Violating any of them breaks the pitch.

### Legal invariants

1. **Blood is never priced, invoiced, sold, or assigned a monetary value anywhere in the codebase.** No column, variable, API field, UI label, or seed record may associate a rupee amount with a blood unit as a product.
2. All money in the system attaches to **services**: cold-chain, testing, logistics, component preparation, platform subscription. Service codes are enumerated in `ARCHITECTURE.md` and the list is closed.
3. **Inter-facility transfers settle in Blood Credits, which are non-monetary and non-convertible.** There is no exchange rate, no cash-out path, no `credit_value_inr` field. Credits exist only inside the network.
4. The word "sale", "price", "buy", or "sell" must never appear in UI copy referring to blood. Use "transfer", "issue", "allocate", "settle".

### System invariants

5. **The credit ledger is double-entry.** Every transfer writes exactly two rows with equal and opposite deltas. `SUM(delta)` across the entire `credit_ledger` table is always `0`. There is a smoke test for this; it must pass.
6. **A blood unit's status only moves forward through the state machine** defined in `ARCHITECTURE.md`. No status may be edited directly. All changes go through service functions that write a `custody_events` row in the same transaction.
7. **Every state change is accompanied by a custody event.** Custody without an event is the exact failure the product claims to solve. There are no exceptions.
8. **A cold-chain breach quarantines affected units automatically and irreversibly.** Quarantine is not user-clearable in this build.
9. **Expiry is computed from `collected_at` plus the component's shelf life**, never stored as a hand-edited value that can drift.
10. **Units inside a facility's emergency reserve floor are INVISIBLE to network allocation.** They are excluded from the solver's candidate set before scoring, not penalised during it. There is no override, no priority level, and no admin flag that can route reserved stock.
11. **Every custody event carries a hash chained to its predecessor.** A unit whose chain does not verify is unroutable and is reported as `integrityValid: false`. Integrity is computed, never stored as a trusted boolean.
12. **The BUA is derived, never stored.** It is computed from the unit's current facility, group, component and RFID UID on every read, so it cannot go stale.

---

## 3. Scope: frozen

### In scope — build these, in this order

| # | Capability | Why it exists |
|---|---|---|
| 1 | Facility + user model with Clerk auth and roles | Everything else needs an actor and a location |
| 2 | Blood unit lifecycle keyed by RFID UID | The atomic object of the system |
| 3 | Custody event log | The trust layer; the reason hardware is on the table |
| 4 | Live inventory dashboard with expiry countdowns | The "silo" problem made visible |
| 5 | At-risk detection + redistribution matching engine | The core insight |
| 6 | Transfer request → accept → settle in credits | The legal innovation |
| 7 | Blood Credit ledger with balances per facility | Proof the market clears without money |
| 8 | Cold-chain telemetry ingest + breach → auto-quarantine | Makes transfers trustworthy |
| 9 | Service billing meter (never for blood) | Proof of the revenue model |
| 10 | Simple demand forecast (moving average) | Feeds the matching engine |
| 11 | Bishop Unit Address and the resolver | Makes units addressable |
| 12 | POST /allocate, the protocol's single call | The product surface |
| 13 | Emergency reserve floors | Makes the optimiser safe |

### Out of scope — do not build, do not stub elaborately

Drones and green corridors. Donor mobile app. Donor CRM and camp management. Payment gateway or real invoicing. Plasma fractionation workflows. NAT test result entry beyond a boolean. ABDM/health-ID integration. Multi-language. Dark mode. Offline mode. Notification emails or SMS. Admin user management UI. Anything involving a real map provider or geocoding API. Machine-learning forecasting. WebSockets or server-sent events. Mobile-responsive polish beyond "does not break".

If a task drifts toward this list, stop and ask.

---

## 4. Technology decisions: locked

Do not substitute, upgrade, or "improve" any of these mid-build. Each was chosen for agent-friendliness and zero-configuration deployment.

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | One codebase, one deploy, API routes and UI together |
| Styling | Tailwind CSS + shadcn/ui | Generate components locally, no runtime dependency risk |
| Database | Neon Postgres (serverless) | Branching is useful; HTTP driver avoids connection-pool pain |
| ORM | Drizzle ORM + `@neondatabase/serverless` | Schema in TypeScript, no binary engine, no generate step to forget |
| Auth | Clerk | `@clerk/nextjs`, middleware-based route protection |
| Data fetching | TanStack Query with `refetchInterval` | **Polling, not sockets.** 4000 ms on dashboards |
| Charts | Recharts | Already proven in the deck's visual language |
| Icons | lucide-react | |
| Deploy | Vercel | Connect the repo, set env vars, done |
| Firmware | Arduino C++ on ESP32, plain HTTPS POST | **No MQTT, no broker, no WebSocket** |

### Explicitly forbidden

- WebSockets, Socket.io, Server-Sent Events, MQTT, Supabase Realtime. Poll.
- Prisma, TypeORM, raw `pg` Pool. Drizzle only.
- NextAuth, Auth.js, custom JWT. Clerk only.
- Redis, BullMQ, cron workers, background job queues. Compute on read.
- Docker, Kubernetes, Terraform, any local database.
- Any AI/ML library. The forecast is a moving average and that is a feature, not a compromise.
- New npm packages not listed above without explicit approval.

---

## 5. Repository conventions

```
/app
  /(marketing)/page.tsx           public landing, one screen, links to sign-in
  /(app)/dashboard/page.tsx       network overview, the money shot
  /(app)/inventory/page.tsx       unit table, filters, expiry countdown
  /(app)/units/[id]/page.tsx      single unit: custody timeline + temp chart
  /(app)/transfers/page.tsx       at-risk units, suggestions, accept/decline
  /(app)/credits/page.tsx         ledger and balances
  /(app)/coldchain/page.tsx       device list, live temps, breach log
  /(app)/billing/page.tsx         service lines, never blood
  /(app)/simulator/page.tsx       virtual scanner + virtual sensor (DEMO FALLBACK)
  /api/ingest/scan/route.ts       device -> RFID scan
  /api/ingest/telemetry/route.ts  device -> temperature reading
  /api/units/...                  app CRUD
  /api/transfers/...              request, accept, decline
  /api/match/route.ts             matching engine output
/lib
  db.ts          drizzle client
  schema.ts      all tables, single file
  domain/        pure business logic, no HTTP, no React
    units.ts     state machine, expiry math
    matching.ts  at-risk detection and ranking
    credits.ts   double-entry writes
    coldchain.ts breach rules
    billing.ts   service line generation
  auth.ts        Clerk helpers, current user -> facility + role
/scripts
  seed.ts        deterministic demo data
/firmware
  bishop_node/bishop_node.ino
```

### Rules

- **All business logic lives in `/lib/domain`.** These are pure functions taking a DB transaction. API routes are thin: authenticate, parse, call domain, return. Components never contain business rules.
- **One schema file.** `lib/schema.ts` holds every table. Do not split it.
- **Server Components by default.** Add `"use client"` only for interactivity.
- **No `any`.** Infer types from Drizzle. If you are fighting types, the schema is wrong, not the types.
- **Dates are `timestamptz`, always UTC in the database, formatted for IST only at the render boundary.**
- **Money is stored as integer paise**, never floats. Field names end in `_paise`.
- Do not write unit tests beyond the invariant smoke tests named in section 8. There is no time.

---

## 6. Design language

Match the pitch deck so the demo and the slides look like one product.

- Background `#F7F7F5` (off-white). Surfaces pure white with a `1px` `#E5E5E0` border, radius `8px`.
- Single accent: navy `#1B2A4A`. One secondary accent: `#5B4B8A` for credits and ledger UI only.
- Status colors used sparingly and only for status: green `#2F7A4F` healthy, amber `#B8860B` at-risk, red `#B03A3A` breach or expired.
- Typography: Inter. Titles `text-2xl font-semibold tracking-tight`. Body `text-sm`. Numbers in tables `tabular-nums`.
- **Generous whitespace. No gradients, no shadows beyond `shadow-sm`, no decorative stripes, no emoji, no em dashes in UI copy.**
- Data density over decoration. A judge should read a screen in four seconds.

---

## 7. Working method for the agent

1. **Plan before code.** For any task touching more than two files, produce a short written plan and wait for approval.
2. **Vertical slices.** Ship schema → domain function → API route → UI for one capability before starting the next. Never leave a half-wired layer.
3. **Run it.** After each slice, start the dev server and confirm the page renders with real seeded data. Do not report a slice complete on the basis of a successful typecheck alone.
4. **Small diffs.** One capability per change. Do not refactor unrelated files.
5. **When blocked for more than ten minutes, stop and surface the blocker.** Do not silently swap a locked technology choice.
6. **Never invent data in the UI.** Every number on screen comes from the database. Hardcoded figures in a demo are the fastest way to lose a Q&A.
7. **Seed data is deterministic.** `pnpm seed` must produce identical output every run so the demo is rehearsable.

---

## 8. Definition of done

The build is complete when all of the following are true, verified by running the app:

- [ ] A signed-in hub operator sees live inventory across all seeded facilities with per-unit expiry countdowns.
- [ ] Posting an RFID UID to `/api/ingest/scan` moves a unit's status and appears in its custody timeline within one poll cycle.
- [ ] The transfers page lists at-risk units with a ranked receiving facility and a stated reason.
- [ ] Accepting a transfer writes two ledger rows, updates both balances, and `SUM(delta) = 0`.
- [ ] Posting an out-of-range temperature to `/api/ingest/telemetry` flags a breach and auto-quarantines the affected units, visible on screen without a manual refresh.
- [ ] The billing page shows service lines only, with no line item attributable to blood.
- [ ] `/simulator` can drive the entire demo with no hardware connected.
- [ ] The app is deployed to a public Vercel URL and works from a phone.
- [ ] `pnpm build` passes with no type errors.
- [ ] `POST /allocate` returns a BUA, a facility, an ETA, a TTL and a custody verdict for a routine request.
- [ ] The same call with priority `EMERGENCY` returns a local reserve unit with `etaMinutes` 0 and raises an automatic replenishment request.
- [ ] At least one seeded scenario makes the solver return a compatible substitute from a farther facility over an exact match nearby, with a reason string that explains why.
- [ ] Tampering with any `custody_events` row causes that unit to report `integrityValid: false` and to disappear from allocation candidates.
- [ ] `/docs` renders the endpoint with a copyable curl command.

---

## 9. Demo safety rules

The demo is the deliverable. Protect it.

- **The hardware path and the software path are the same API.** The ESP32 and the `/simulator` page post identical payloads. If the hardware fails on stage, the demo continues from a browser tab and nobody can tell.
- **Never demo against a laptop hotspot as the only network.** Deploy to Vercel and demo from the public URL.
- **Freeze the code at T+16:00.** The final two hours are seeding, rehearsal, and recovery. No commits after the freeze except to fix a demo-blocking bug.
- **Rehearse the ninety-second flow three times end to end** before presenting. The demo script is in `ARCHITECTURE.md`, section 11.
# Bishop
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
# BishopOS

**The operating system for a blood-supply network.**

Real-time inventory, RFID-verified chain of custody, cold-chain monitoring, and a non-monetary Blood Credit market that makes inter-facility transfer possible — built on real Dhanbad-area blood bank data, not placeholder rows.

> Blood is a perishable, partially-substitutable asset that moves between institutions which do not trust each other. No inventory system can model that — which is why every existing platform can only answer *"does this hospital have O+?"* BishopOS gives every unit of blood a routable address and a time-to-live, and exposes one call that returns the single unit, anywhere in the network, whose allocation costs the network least.

`Dhanbad · Jharkhand network pilot` — built for the **VentureX 18-Hour Business & Innovation Hackathon, IIT (ISM) Dhanbad**.

---

## Links

| | |
|---|---|
| Live app | _add deployment URL_ |
| Interactive prototype | https://claude.ai/code/artifact/0c077ff3-25b7-4da3-87ff-29545ddde0f1?via=auto_preview |
| Pitch deck | [`docs/Bishop.pptx`](docs/Bishop.pptx) |
| Design brief | [`docs/design-brief.md`](docs/design-brief.md) |
| API docs | `/docs` |

---

## Contents

- [The problem](#the-problem)
- [Why the existing system stops short](#why-the-existing-system-stops-short)
- [Where BishopOS sits](#where-bishopos-sits)
- [Core primitives](#core-primitives)
- [The allocation call](#the-allocation-call)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API surface](#api-surface)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Design system](#design-system)
- [The business underneath the software](#the-business-underneath-the-software)
- [Regulatory position](#regulatory-position)
- [Roadmap](#roadmap)
- [Risks](#risks)
- [Assumptions & references](#assumptions--references)

---

## The problem

India's blood shortage is a **financing and logistics failure, not a donor failure.**

The WHO benchmark is donations from ~1% of the population. India runs at roughly 0.8% — a gap of a few million units a year. The cause is not unwillingness to donate. It is that donation drives, collection logistics, and cold-chain storage have no sustainable funding model behind them.

Three failures compound:

**1. The funding gap.** Processing a unit costs ₹800–2,700. The regulatory cap on the processing fee is ₹1,050–1,450, and blood must be free at the point of care. Every unit processed can run a deficit of ₹50–₹1,250. So 2,700–3,000+ blood banks operate as loss-making NGO or hospital appendages, kept alive by fragmented, delayed government grants that cover roughly 40% of real cost.

**2. Cold-chain collapse.** Around 40% of blood collected in rural India is wasted to power failures and inadequate cold storage. That is a logistics problem wearing the costume of a supply problem.

**3. Inventory fragmentation.** There is no national real-time inventory. Hospital A holds surplus expiring tomorrow while Hospital B, 20 km away, turns a patient away. Roughly 7 lakh units are discarded annually to expiry (NBTC).

The binding constraint is regulatory and economic, not medical: the Drugs & Cosmetics Act, 1940 and the National Blood Policy, 2002 prohibit the sale of blood. Any solution that clears the market with money is illegal in India by construction.

**Stakeholders carrying the cost:** patients (trauma, surgical, thalassemia, maternal) facing delay or denial · blood banks running at structural loss · hospitals bearing liability and reputational risk of stock-outs · government funding ~40% of real cost through fragmented grants.

---

## Why the existing system stops short

India already has a national portal, **e-RaktKosh**. It provides visibility. Five operational failures stop it becoming infrastructure:

| # | Failure | Consequence |
|---|---|---|
| 01 | **Ghost inventory** | Issued-unit entries lag by weeks. Online stock ≠ shelf stock. Patients are misled in emergencies. |
| 02 | **Single-user records** | One person per record at a time. Bottlenecks during high-volume camps. |
| 03 | **No offline mode** | Rural power cuts and connectivity gaps block updates; donor records are lost outright. |
| 04 | **One trained operator** | Training isn't systemic. Usage collapses the moment that person is absent. |
| 05 | **No dedicated staff** | Nurses and technicians do data entry alongside clinical duties — error rates and burnout. |

And beneath all five, the structural one: **visibility is not transfer.** A directory tells you what a bank *says* it has. It cannot prove a cold chain and it cannot settle an exchange. Nine years of legally permitted inter-bank transfer, and it still does not happen at scale.

---

## Where BishopOS sits

Every player in this market answers a different question. Only one of them answers the question a doctor actually has.

| | e-RaktKosh | Blood bank SaaS | Bloodbuy (US) | **BishopOS** |
|---|---|---|---|---|
| What it is | Government directory | Single-site software | Commercial marketplace | **Allocation protocol** |
| Question it answers | Who has stock | What this bank holds | Who will sell to me | **Which unit should I use** |
| Custody proof | Self-reported | Within one site only | Contractual | **Hash-chained, recomputed** |
| Settlement | None | None | Cash — illegal in India | **Non-monetary credits** |
| Works without hardware | Yes, unverified | Partly | No | **Yes, four identity tiers** |
| Reach | National, partial data | Per site | 450+ US hospitals | **Any facility, any tier** |

Existing players are either public directories or single-site tools. None combines **verified custody, a legal settlement layer, and an open allocation API**.

Bloodbuy proves the market clears once facilities get a platform. It settles in dollars, which Indian law forbids. The credit ledger is what closes that gap.

---

## Core primitives

### 1. Bishop Unit Address (BUA)

Every unit gets a routable address derived from its RFID tag, blood group, component and current facility. It changes when the unit moves — exactly like an IP address.

```
bua:SPK-DHN-SNCM/O_POS/PRBC/04A3B2C1
    │   │   │      │     │     └── serial — stable for the unit's lifetime
    │   │   │      │     └──────── component
    │   │   │      └────────────── ABO/Rh group
    │   │   └───────────────────── facility code — rewritten on transfer
    │   └───────────────────────── district
    └───────────────────────────── state / network segment
```

| Segment | Meaning | Mutable |
|---|---|---|
| `SPK` | Network segment / state | No |
| `DHN` | District | On inter-district transfer |
| `SNCM` | Holding facility | **Yes — on every custody handoff** |
| `O_POS` | ABO/Rh group | No |
| `PRBC` | Component (`PRBC` · `FFP` · `PLT` · `CRYO`) | No |
| `04A3B2C1` | RFID-derived serial | No |

The address is the join key across inventory, custody, cold chain and the ledger. If you can name a unit, you can route it.

**Four identity tiers.** Full RFID is the ideal, not the requirement. A facility with no hardware still participates through manual entry with a lower trust weight — the allocation function knows the difference and prices it.

### 2. Custody hash chain

Every state change — collection, testing, component separation, transfer, temperature reading, issue — writes a chained, cryptographically verified event. Each event hashes the previous one.

```
collected ──▶ tested ──▶ separated ──▶ transferred ──▶ issued
   h₀           h₁           h₂            h₃            h₄
                          h₂ = H(h₁ ‖ event₂)
```

The chain is **recomputed on read**, not trusted from a status column. A unit whose chain fails verification is dropped from the allocation pool and surfaced as an alert — **never silently hidden**. Custody integrity is a first-class input to allocation, not a compliance afterthought.

### 3. Blood Credits

Two distinct non-monetary instruments. Neither is convertible to currency. **No rupee ever prices a unit of blood.**

**Facility Credits — the inter-facility settlement ledger.**
Double-entry and reciprocal: when facility A transfers a unit to facility B, A is credited and B is debited in the same transaction. Balances are capped at a **−5 overdraft floor** — a facility that takes without ever giving is locked out of drawing further, which is what makes the ledger self-policing without an enforcement authority. Denominated in `cr`, formatted without a currency symbol anywhere in the UI.

**Donor Credits — the replacement-donor instrument.**
ABDM-linked credits earned by donors, redeemable nationally by their family against the replacement-donor requirement. This solves the replacement-donor problem without constituting a sale: what is transferred is a *claim on priority within a queue*, never blood, and never money.

### 4. Cold-chain monitoring

IoT sensors on smart-fridges and transit containers write temperature readings **into the same custody chain** as every other event. An excursion is not a separate log line — it is part of the unit's provable history, and it reduces that unit's allocation eligibility automatically.

---

## The allocation call

The product is one endpoint. `POST /allocate` returns the single unit, anywhere in the network, whose allocation costs the network least.

```http
POST /allocate
Content-Type: application/json

{
  "group": "O_POS",
  "component": "PRBC",
  "units": 1,
  "urgency": "urgent",
  "requesting_facility": "SPK-DHN-CENTRAL"
}
```

```json
{
  "allocated": {
    "address": "bua:SPK-DHN-SNCM/O_POS/PRBC/04A3B2C1",
    "facility": "SNCM",
    "distance_km": 6.4,
    "ttl_hours": 460,
    "custody": "verified",
    "cost": 3.82,
    "breakdown": {
      "distance": 1.28,
      "rarity": 0.94,
      "shelf_life": 0.71,
      "network_resilience": 0.89
    }
  },
  "alternatives_considered": 7,
  "credit_effect": { "SNCM": "+1", "CENTRAL": "-1" }
}
```

**The cost function** weighs four terms:

| Term | What it captures | Direction |
|---|---|---|
| **Distance** | Transport time and cold-chain exposure | Nearer is cheaper |
| **Rarity** | Scarcity of the group/component *in the network*, not at one site | Spending a rare unit is expensive |
| **Shelf life** | Time-to-live remaining | **Nearly-expired units are cheap — the system prefers to spend them first** |
| **Network resilience** | Damage to the source facility's ability to serve its own catchment after the transfer | Draining a sole regional holder is expensive |

The shelf-life term is where the ~7 lakh annual expiry losses get attacked. A naive system reaches for the freshest unit; BishopOS reaches for the unit that would otherwise be discarded, provided it still safely serves the case.

The score decomposition is returned in every response and rendered in the UI — the allocation is an auditable routing decision, not an opaque `WHERE` clause.

---

## Architecture

```
                        ┌──────────────────────────────┐
   RFID readers ───────▶│                              │
   Smart-fridge IoT ───▶│      Ingest / event API      │
   Manual entry ───────▶│                              │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │      Custody chain writer     │
                        │  hash(prev ‖ event) · verify  │
                        └──────────────┬───────────────┘
                                       ▼
        ┌──────────────┬───────────────┴───────┬──────────────────┐
        ▼              ▼                       ▼                  ▼
  ┌───────────┐  ┌───────────┐         ┌──────────────┐   ┌─────────────┐
  │ Inventory │  │ Cold chain│         │ Credit ledger│   │  Facilities │
  │ addressed │  │  readings │         │ double-entry │   │  + geodata  │
  └─────┬─────┘  └─────┬─────┘         └──────┬───────┘   └──────┬──────┘
        └──────────────┴────────┬─────────────┴──────────────────┘
                                ▼
                   ┌─────────────────────────┐
                   │   Allocation engine      │
                   │  cost = f(d, r, ttl, n)  │
                   └────────────┬─────────────┘
                                ▼
              POST /allocate ── one unit + score breakdown
                                │
                   ┌────────────┴─────────────┐
                   ▼                          ▼
            Operator dashboard          Partner systems
                                        (HIS / e-RaktKosh)
```

**Design rule:** the ledger is written in the same transaction as the custody event. A transfer that doesn't settle doesn't happen — there is no reconciliation job, because there is nothing to reconcile.

---

## Data model

| Entity | Key fields |
|---|---|
| `facilities` | code, name, tier, identity tier, lat/lng, catchment population, cold-chain capacity |
| `units` | id, BUA, group, component, collected_at, expires_at, current_facility, status |
| `custody_events` | id, unit_id, seq, type, actor, facility, payload, prev_hash, hash, created_at |
| `temperature_readings` | id, sensor_id, facility/container, celsius, recorded_at, unit_ids in scope |
| `ledger_entries` | id, transfer_id, facility, direction, amount, balance_after, created_at |
| `allocations` | id, request, chosen_unit, cost, breakdown, alternatives, decided_at |
| `donors` | id, abdm_ref, last_donation_at, credit_balance, eligibility_state |

Invariants worth stating out loud:

- `custody_events` is **append-only**. Corrections are new events, never updates.
- `ledger_entries` sum to zero across every `transfer_id`.
- A unit is allocatable only if `expires_at > now()`, chain verification passes, and no unresolved cold-chain excursion covers its custody window.

---

## API surface

> Paths reflect the current build — confirm against `app/api` before publishing externally.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/allocate` | Return the least-cost unit for a request |
| `GET` | `/units/:bua` | Unit detail with full custody chain |
| `GET` | `/inventory` | Network inventory, filterable by facility, group, component, TTL |
| `POST` | `/units/:bua/transfer` | Record a handoff — writes custody event + ledger pair |
| `POST` | `/events` | Ingest a custody or sensor event |
| `GET` | `/facilities/:code` | Facility profile, position, reliability |
| `GET` | `/ledger` | Ledger entries and balances |
| `GET` | `/alerts` | Expiry, excursion, broken-chain and shortage alerts |

Auth is per-facility API key plus operator session. Every write records the actor into the custody chain — there are no anonymous state changes.

---

## Getting started

> Update the commands below if your local stack differs from what's committed.

**Prerequisites:** Node 20+, pnpm (or npm), a Postgres database, and credentials for the auth provider configured in the repo.

```bash
git clone <repo-url>
cd bishopos
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`:

```env
DATABASE_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
# auth provider keys
# sensor / ingest webhook secret
```

Then:

```bash
pnpm db:migrate     # schema
pnpm db:seed        # Dhanbad-area facilities + seed inventory
pnpm dev            # http://localhost:3000
```

Seed data models real Dhanbad-area blood banks and their approximate geography so the allocation engine produces meaningful distances out of the box.

---

## Project structure

```
app/
  (marketing)/        landing, API docs
  (auth)/             sign-in, sign-up          ← do not modify without review
  dashboard/
    overview/         network NOC
    inventory/        group × component matrix
    allocate/         allocation console
    units/[bua]/      unit detail + custody chain
    cold-chain/       sensors, excursions
    credits/          ledger, balances, overdraft
    facilities/
    alerts/
  api/                route handlers
components/
  primitives/         Button, Card, Chip, Table, Toast, Skeleton
  bishop/             UnitAddress, TTLRing, CustodyChain, NetworkCanvas, AllocationScore
lib/
  allocation/         cost function + scoring
  custody/            hashing, chain verification
  ledger/             double-entry writer, overdraft rules
  db/                 schema, queries, migrations
docs/
  Bishop.pptx         pitch deck
  design-brief.md     UI/UX specification
```

---

## Design system

Full specification in [`docs/design-brief.md`](docs/design-brief.md).

**Palette.** Arterial red `#A4161A` as brand, straw `#D69A2D` for plasma, `#2B7FD4` for cold chain, `#1E7A4B` for verified custody, on warm red-undertoned neutrals. Alert red `#FF4526` is deliberately distinct from brand red — if the whole interface is red, nothing reads as urgent.

**Type.** Archivo for display, Inter Tight for UI, JetBrains Mono for anything the system generated — addresses, hashes, TTLs, counts, credit amounts. Human-written text is never mono; machine-generated text always is. That split is the visual grammar.

**Signature components.** `UnitAddress` (segmented, decodable, copyable) · `TTLRing` (drains as shelf life burns) · `CustodyChain` (visibly severed when broken) · `NetworkCanvas` (live routing map) · `AllocationScore` (the four-term cost decomposition).

Accessibility floor: 4.5:1 body contrast, colour never the sole signal, keyboard-navigable throughout, `prefers-reduced-motion` respected, works at 360px, dark mode ships with light.

---

## The business underneath the software

BishopOS is the platform layer of **Bishop**, a Section 8 managed-services company operating the collection-to-hospital chain as a subscription utility — the *Vascular Utility Model*. It decouples the free biological gift from the paid, professional service wrapped around it. Hospitals stop running loss-making in-house blood banks and subscribe to guaranteed availability instead.

**Four operating pillars**

| | |
|---|---|
| **Hub & spoke** | Regional mega-hubs (collection, NAT testing, component prep) feeding IoT smart-fridges inside partner hospitals |
| **BishopOS** | Real-time inventory API, demand forecasting, SLA-breach dashboard, donor CRM, cold-chain alerts |
| **Digital Blood Credit** | ABDM-linked donor credits redeemable nationally — solves replacement donors without a sale |
| **Vascular Express** | Tier-1 scheduled refrigerated delivery, Tier-2 emergency drone / green-corridor, 30–60 min SLA |

**Customer journey:** hospital signs SLA → smart-fridge installed → milk-run vans collect, hub runs NAT → BishopOS forecasts and routes stock → JIT delivery in 30–60 min → RFID auto-bills the subscription.

**Unit economics**

| Revenue per unit | | Cost side | |
|---|---|---|---|
| Permitted processing fee | ₹1,450 | NAT testing, centralized | ₹1,200 → ₹650 (−₹550) |
| Hospital subscription, amortized | ₹400 | Last-mile, milk-run | ₹200 → ₹80 (−₹120) |
| Insurance availability premium | ₹300 | **Optimized cost / unit** | **₹1,950** |
| **Total revenue / unit** | **₹2,150** | **Net margin** | **+₹200** |

Centralization is what turns the deficit positive. The margin does not come from pricing blood — it comes from removing duplicated testing and single-site logistics.

**Subscription plans:** ₹2 L/yr up to 5,000 units · ₹11 L/yr up to 20,000 units. A large hospital's blood bank nets it roughly ₹10 L on ₹2.3 Cr of turnover today, at a capped ₹50/unit regulated margin, while carrying capex, staffing, cold chain and every expired unit. The pitch is that they give up a margin they barely earn and stop paying for all of it. At 400 contracted hospitals that's ~₹40 Cr recurring.

**Trajectory:** Year 1 ₹6 Cr (3 cities, 20 hospitals, 1 hub) → Years 2–3 ₹40 Cr (10 cities, 150 hospitals, 50 CSR partners) → Year 4+ ₹105 Cr, national, self-sustaining.

**Funding path:** Year-1 pilot via social impact bonds with impact investors and government/CSR as outcome payors → Series A plus NHM contracts in Years 2–3 → self-sustaining by Year 4. A hub breaks even once hospital subscriptions and insurance premiums cover fixed cold-chain cost, independently of per-unit volume swings.

**Market frame:** TAM — all 3,000+ Indian blood banks, hospitals and insurers needing testing, logistics and inventory services. SAM — Tier-1/2 hospitals and insurers reachable hub-and-spoke: a 500M insured base (₹500 Cr/yr availability-premium pool) plus mandatory 2% CSR spend under the Companies Act. SOM — phase-wise capture from 3 cities to national across four years.

**Go to market:** direct B2B sales to hospital administrators, corporate HR/CSR tie-ups, NHM/PPP tenders, insurer pilots. Consultative and pilot-first — discounted trial SLA for early hospitals, CDSCO-reviewed tariff for credibility, land and expand city by city.

---

## Regulatory position

Blood is never sold. Every revenue line is a service line.

| Service | Applicable law | Status |
|---|---|---|
| Hospital SLA / availability guarantee | Contract Act, 1872 | Fully permissible |
| Cold-chain logistics fee | Motor Vehicles Act / logistics tariff | Fully permissible |
| Component testing | Clinical Establishments Act | Diagnostic service — commercial |
| BishopOS SaaS licensing | IT Act, 2000 | Software — fully commercial |
| CSR donor-drive management | Companies Act, 2013 §135 | FCRA-compliant NGO passthrough |
| Plasma fractionation royalty | CDSCO licensing required | Requires approval — Year 4 |

The credit ledger exists precisely because the Drugs & Cosmetics Act, 1940 and the National Blood Policy, 2002 forbid the cash settlement Bloodbuy relies on. Credits are non-monetary, non-convertible, and carry no cash value at any point.

---

## Roadmap

| Phase | Duration | Milestones |
|---|---|---|
| **1 — Pilot** | 0–6 months | 1 mega-hub + 10 smart-spokes in a Tier-1 city; app launch; 3 cities / 20 hospitals live |
| **2 — Scale** | 6–18 months | 5 cities; 3 major insurers integrated; BishopOS platform live; 50 CSR partners |
| **3 — National** | 18–36 months | National Blood Credit settlement layer; rural reach via drones; BishopOS export readiness |

**Scalability.** Each hub serves ~5M population — a repeatable unit, not a one-off build. BishopOS scales at near-zero marginal cost as pure software. The long-term shape is what NPCI/UPI became for payments: a neutral, high-efficiency layer that never owns the underlying asset.

**Future expansion:** plasma fractionation revenue-share (pending CDSCO), BishopOS export to South and Southeast Asia, medical-drone rural reach, national credit settlement.

**KPIs:** cold-chain uptime % · wastage-rate reduction · hospital SLA breach rate · donor repeat rate (target 60% by Yr 2) · revenue vs ₹105 Cr Yr-4 target · cost/unit vs ₹1,950 target.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Regulatory challenge to the service-fee model | Medium | Pre-cleared tariff structure co-designed with a CDSCO advisory board |
| Hospital payment delays or defaults | Medium | Escrow: quarterly prepayment in advance |
| Donor base not reaching critical mass | High | Diversified acquisition — app, corporates, colleges, temples, events |
| Cold-chain power failure in Tier-3 | Medium | Solar + battery backup at every cold-storage node |
| CSR funding dips in a downturn | Medium | NHM contracts provide base revenue independent of CSR |
| Competition from state-run blood banks | Low | PPP model — Bishop augments state banks rather than replacing them |

---

## Assumptions & references

**Assumptions.** Regulatory processing-fee cap holds at ₹1,050–1,450 throughout · NAT centralization saves ₹550/unit and milk-run logistics ₹120/unit · 500M insured base at ₹10/policyholder/yr = ₹500 Cr sector-wide pool · hub density benchmark ~1 mega-hub per 5M population.

**References.** Drugs and Cosmetics Act, 1940 · National Blood Policy, 2002 · Ayushman Bharat Digital Mission (ABDM) · National Blood Transfusion Council (NBTC) data · Companies Act, 2013 §135 (CSR) · WHO donation-rate benchmark.

---

## Contributing

Two rules specific to this repo:

1. **Never mutate a custody event.** Corrections are appended as new events with a reference to what they correct. The chain's value is that it cannot be quietly rewritten.
2. **Never let a rupee figure touch a unit of blood** — not in the schema, not in the API, not in a UI string. Credits are `cr`, unformatted, non-convertible. This is a legal constraint, not a style preference.

---

## Disclaimer

Financial projections, market sizing and unit economics in this README are hackathon-stage estimates from the pitch deck, built on public NBTC/WHO figures and stated assumptions. They have not been externally audited. BishopOS is a prototype and is not a certified medical device or a licensed blood-bank management system; clinical deployment would require CDSCO/NBTC review and state blood transfusion council approval.

---

## License & credits

Built for the VentureX 18-Hour Business & Innovation Hackathon, IIT (ISM) Dhanbad.

_Add license and team credits here._

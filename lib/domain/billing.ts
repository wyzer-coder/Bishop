// ARCHITECTURE.md section 8. HARD RULE, enforced by this comment and by
// review: there is no service code for the blood itself, and there must
// never be one. Every code in SERVICE_TARIFFS_PAISE bills a service
// (cold chain, testing, component prep, logistics, platform subscription)
// performed ON a unit or FOR a facility — never the biological product
// itself. No function in this file may accept or persist a rupee amount
// against blood-as-product. See CLAUDE.md section 2, legal invariants 1-4.
import { billingLines } from "@/lib/schema";
import type { Tx } from "@/lib/domain/units";
import type { serviceCodeEnum } from "@/lib/schema";

type ServiceCode = (typeof serviceCodeEnum.enumValues)[number];

// Indicative tariffs in paise, per ARCHITECTURE.md section 8's table.
export const SERVICE_TARIFFS_PAISE: Record<Exclude<ServiceCode, "PLATFORM_SLA">, number> = {
  COLD_CHAIN_STORAGE: 25_000, // Unit received at a spoke fridge — ₹250
  NAT_TESTING: 65_000, // nat_tested set true at hub — ₹650
  COMPONENT_PREP: 30_000, // Component produced from whole blood — ₹300
  LAST_MILE_LOGISTICS: 8_000, // Shipment delivered — ₹80
};

type LineInput = {
  facilityId: string;
  unitId?: string | null;
  description: string;
};

async function writeLine(tx: Tx, code: ServiceCode, amountPaise: number, input: LineInput) {
  const [line] = await tx
    .insert(billingLines)
    .values({
      facilityId: input.facilityId,
      unitId: input.unitId ?? null,
      code,
      description: input.description,
      amountPaise,
    })
    .returning();
  return line;
}

/** Trigger: a unit is received (SCANNED_IN) at a spoke's fridge. */
export function coldChainStorageLine(tx: Tx, facilityId: string, unitId: string, rfidUid: string) {
  return writeLine(tx, "COLD_CHAIN_STORAGE", SERVICE_TARIFFS_PAISE.COLD_CHAIN_STORAGE, {
    facilityId,
    unitId,
    description: `Cold-chain storage — ${rfidUid}`,
  });
}

/** Trigger: nat_tested flips to true at the hub (TESTING -> AVAILABLE). */
export function natTestingLine(tx: Tx, hubFacilityId: string, unitId: string, rfidUid: string) {
  return writeLine(tx, "NAT_TESTING", SERVICE_TARIFFS_PAISE.NAT_TESTING, {
    facilityId: hubFacilityId,
    unitId,
    description: `NAT testing — ${rfidUid}`,
  });
}

/** Trigger: a component (not WHOLE) is produced from collected blood at the hub. */
export function componentPrepLine(tx: Tx, hubFacilityId: string, unitId: string, rfidUid: string) {
  return writeLine(tx, "COMPONENT_PREP", SERVICE_TARIFFS_PAISE.COMPONENT_PREP, {
    facilityId: hubFacilityId,
    unitId,
    description: `Component preparation — ${rfidUid}`,
  });
}

/** Trigger: a shipment reaches DELIVERED. One line per unit it carried. */
export function lastMileLogisticsLine(tx: Tx, facilityId: string, unitId: string, rfidUid: string) {
  return writeLine(tx, "LAST_MILE_LOGISTICS", SERVICE_TARIFFS_PAISE.LAST_MILE_LOGISTICS, {
    facilityId,
    unitId,
    description: `Last-mile logistics — ${rfidUid}`,
  });
}

/** Trigger: monthly, per contracted spoke. Amount comes from the facility's
 * own sla_contracts row (tier-priced), not from this file's flat table. */
export function platformSlaLine(tx: Tx, facilityId: string, tier: string, monthlyAmountPaise: number) {
  return writeLine(tx, "PLATFORM_SLA", monthlyAmountPaise, {
    facilityId,
    unitId: null,
    description: `Platform SLA — ${tier} tier`,
  });
}

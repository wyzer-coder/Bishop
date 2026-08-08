// ARCHITECTURE.md section 6: the Blood Credit ledger.
import { eq, sql } from "drizzle-orm";
import { transitionUnit, type Tx } from "@/lib/domain/units";
import { creditLedger, shipments, transfers } from "@/lib/schema";

const OVERDRAFT_LIMIT = -5;

async function currentBalance(tx: Tx, facilityId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: sql<string>`COALESCE(SUM(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.facilityId, facilityId));
  return Number(row?.balance ?? 0);
}

export class OverdraftError extends Error {
  constructor(facilityId: string, balance: number, credits: number) {
    super(
      `Facility ${facilityId} is at ${balance} credits; receiving ${credits} more would breach the ${OVERDRAFT_LIMIT} overdraft limit.`,
    );
    this.name = "OverdraftError";
  }
}

/**
 * Runs inside one transaction:
 * 1. Locks/reads both facilities' current balances.
 * 2. Writes +credits for the offering facility and -credits for the
 *    receiving facility, each with the recomputed balance_after.
 * 3. Moves the unit AVAILABLE -> RESERVED via transitionUnit (the only way
 *    a unit's status may change), writing a TRANSFER_ACCEPTED custody
 *    event with its own chain hash.
 * 4. Sets the transfer to ACCEPTED and creates a shipments row.
 */
export async function settleTransfer(tx: Tx, transferId: string) {
  const [transfer] = await tx
    .select()
    .from(transfers)
    .where(eq(transfers.id, transferId))
    .for("update");
  if (!transfer) {
    throw new Error(`Transfer ${transferId} not found`);
  }
  if (transfer.status !== "SUGGESTED" && transfer.status !== "REQUESTED") {
    throw new Error(`Transfer ${transferId} is ${transfer.status}, not accept-eligible`);
  }

  const offeringBalance = await currentBalance(tx, transfer.offeringFacilityId);
  const receivingBalance = await currentBalance(tx, transfer.receivingFacilityId);

  if (receivingBalance - transfer.credits < OVERDRAFT_LIMIT) {
    throw new OverdraftError(transfer.receivingFacilityId, receivingBalance, transfer.credits);
  }

  const offeringBalanceAfter = offeringBalance + transfer.credits;
  const receivingBalanceAfter = receivingBalance - transfer.credits;

  await tx.insert(creditLedger).values([
    {
      facilityId: transfer.offeringFacilityId,
      delta: transfer.credits,
      balanceAfter: offeringBalanceAfter,
      transferId: transfer.id,
      reason: `Transfer accepted — offered unit`,
    },
    {
      facilityId: transfer.receivingFacilityId,
      delta: -transfer.credits,
      balanceAfter: receivingBalanceAfter,
      transferId: transfer.id,
      reason: `Transfer accepted — received unit`,
    },
  ]);

  await transitionUnit(tx, transfer.unitId, "RESERVED", {
    eventType: "TRANSFER_ACCEPTED",
    meta: { transferId: transfer.id },
  });

  const [shipment] = await tx
    .insert(shipments)
    .values({
      fromFacilityId: transfer.offeringFacilityId,
      toFacilityId: transfer.receivingFacilityId,
      status: "PREPARING",
    })
    .returning({ id: shipments.id });

  const [updatedTransfer] = await tx
    .update(transfers)
    .set({ status: "ACCEPTED", shipmentId: shipment.id, resolvedAt: new Date() })
    .where(eq(transfers.id, transferId))
    .returning();

  return {
    transfer: updatedTransfer,
    offeringBalance: offeringBalanceAfter,
    receivingBalance: receivingBalanceAfter,
  };
}

export async function declineTransfer(tx: Tx, transferId: string) {
  const [transfer] = await tx
    .select()
    .from(transfers)
    .where(eq(transfers.id, transferId))
    .for("update");
  if (!transfer) {
    throw new Error(`Transfer ${transferId} not found`);
  }
  if (transfer.status !== "SUGGESTED" && transfer.status !== "REQUESTED") {
    throw new Error(`Transfer ${transferId} is ${transfer.status}, not decline-eligible`);
  }

  const [updated] = await tx
    .update(transfers)
    .set({ status: "DECLINED", resolvedAt: new Date() })
    .where(eq(transfers.id, transferId))
    .returning();
  return updated;
}

export async function getLedger(tx: Tx, facilityId?: string) {
  const rows = facilityId
    ? await tx.select().from(creditLedger).where(eq(creditLedger.facilityId, facilityId))
    : await tx.select().from(creditLedger);
  return rows;
}

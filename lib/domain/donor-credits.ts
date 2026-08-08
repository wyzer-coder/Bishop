// Personal / family blood credits — additive layer, separate from the
// institutional credit_ledger in lib/domain/credits.ts. See the schema
// comment in lib/schema.ts for the model this implements.
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/domain/units";
import { transitionUnit } from "@/lib/domain/units";
import { bloodUnits, donorCreditLedger, donorFamilyMembers, donors } from "@/lib/schema";

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function currentBalance(tx: Tx, donorId: string): Promise<number> {
  const [row] = await tx
    .select({ balanceAfter: donorCreditLedger.balanceAfter })
    .from(donorCreditLedger)
    .where(eq(donorCreditLedger.donorId, donorId))
    .orderBy(desc(donorCreditLedger.createdAt))
    .limit(1);
  return row?.balanceAfter ?? 0;
}

export async function findOrCreateDonor(
  tx: Tx,
  input: { name: string; phone: string; facilityId?: string; rfidUid?: string },
) {
  const [existing] = await tx.select().from(donors).where(eq(donors.phone, input.phone)).limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(donors)
    .values({
      name: input.name,
      phone: input.phone,
      facilityId: input.facilityId,
      rfidUid: input.rfidUid,
    })
    .returning();
  return created;
}

export async function findDonorByRfid(tx: Tx, rfidUid: string) {
  const [donor] = await tx.select().from(donors).where(eq(donors.rfidUid, rfidUid)).limit(1);
  return donor ?? null;
}

export async function recordDonation(
  tx: Tx,
  input: { name: string; phone: string; facilityId: string; rfidUid?: string },
) {
  const donor = await findOrCreateDonor(tx, input);
  const balance = await currentBalance(tx, donor.id);
  const balanceAfter = balance + 1;
  await tx.insert(donorCreditLedger).values({
    donorId: donor.id,
    delta: 1,
    balanceAfter,
    reason: `Donation at facility`,
  });
  return { donor, balance: balanceAfter };
}

/**
 * A recognized donor card tapped again — no name/phone re-entry needed,
 * just another +1 credit for the same person. Used by the scan ingest
 * route when a tap resolves to an existing donors.rfid_uid.
 */
export async function recordReturningDonation(tx: Tx, donor: { id: string }) {
  const balance = await currentBalance(tx, donor.id);
  const balanceAfter = balance + 1;
  await tx.insert(donorCreditLedger).values({
    donorId: donor.id,
    delta: 1,
    balanceAfter,
    reason: "Donation at facility (card tap)",
  });
  return { balance: balanceAfter };
}

export async function addFamilyMember(
  tx: Tx,
  input: { donorId: string; memberName: string; memberPhone: string },
) {
  const code = randomCode();
  const [row] = await tx
    .insert(donorFamilyMembers)
    .values({
      donorId: input.donorId,
      memberName: input.memberName,
      memberPhone: input.memberPhone,
      verificationCode: code,
    })
    .returning();
  return row;
}

export class VerificationError extends Error {}

export async function verifyFamilyMember(
  tx: Tx,
  input: { familyMemberId: string; code: string },
) {
  const [link] = await tx
    .select()
    .from(donorFamilyMembers)
    .where(eq(donorFamilyMembers.id, input.familyMemberId))
    .limit(1);
  if (!link) throw new VerificationError("Family member link not found");
  if (link.status === "VERIFIED") return link;
  if (link.verificationCode !== input.code) {
    throw new VerificationError("Verification code does not match");
  }
  const [updated] = await tx
    .update(donorFamilyMembers)
    .set({ status: "VERIFIED", verifiedAt: new Date() })
    .where(eq(donorFamilyMembers.id, input.familyMemberId))
    .returning();
  return updated;
}

export class RedemptionError extends Error {}

/**
 * Redeems one credit: walks the unit through the same forward-only state
 * machine every other issuance uses (AVAILABLE -> RESERVED -> IN_TRANSIT ->
 * ISSUED), each step writing its own custody event — no shortcut around
 * CLAUDE.md's "status only moves forward, always with an event" rule just
 * because this is a different call site.
 */
export async function redeemCredit(
  tx: Tx,
  input: { donorId: string; familyMemberId: string; unitId: string },
) {
  const [link] = await tx
    .select()
    .from(donorFamilyMembers)
    .where(
      and(
        eq(donorFamilyMembers.id, input.familyMemberId),
        eq(donorFamilyMembers.donorId, input.donorId),
      ),
    )
    .limit(1);
  if (!link || link.status !== "VERIFIED") {
    throw new RedemptionError("Family member is not a verified link for this donor");
  }

  const balance = await currentBalance(tx, input.donorId);
  if (balance <= 0) {
    throw new RedemptionError("Donor has no credit balance to redeem");
  }

  const [unit] = await tx.select().from(bloodUnits).where(eq(bloodUnits.id, input.unitId)).limit(1);
  if (!unit || unit.status !== "AVAILABLE") {
    throw new RedemptionError("Unit is not available to issue");
  }
  const facilityId = unit.currentFacilityId;

  await transitionUnit(tx, unit.id, "RESERVED", {
    eventType: "RELEASED",
    toFacilityId: facilityId,
    meta: { donorId: input.donorId, familyMemberId: input.familyMemberId, reason: "family_credit_redemption" },
  });
  await transitionUnit(tx, unit.id, "IN_TRANSIT", {
    eventType: "DISPATCHED",
    toFacilityId: facilityId,
    meta: { donorId: input.donorId, familyMemberId: input.familyMemberId },
  });
  await transitionUnit(tx, unit.id, "ISSUED", {
    eventType: "ISSUED_TO_PATIENT",
    toFacilityId: facilityId,
    meta: { donorId: input.donorId, familyMemberId: input.familyMemberId },
  });

  const balanceAfter = balance - 1;
  await tx.insert(donorCreditLedger).values({
    donorId: input.donorId,
    delta: -1,
    balanceAfter,
    reason: `Redeemed for ${link.memberName}`,
    unitId: unit.id,
    familyMemberId: link.id,
  });

  return { balance: balanceAfter, unitId: unit.id };
}

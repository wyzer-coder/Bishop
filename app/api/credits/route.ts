import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, facilities } from "@/lib/schema";

// ARCHITECTURE.md section 9: balances and ledger.
export async function GET() {
  const allFacilities = await db.select().from(facilities);

  const balanceRows = await db
    .select({
      facilityId: creditLedger.facilityId,
      balance: sql<string>`COALESCE(SUM(${creditLedger.delta}), 0)`,
    })
    .from(creditLedger)
    .groupBy(creditLedger.facilityId);
  const balanceByFacility = new Map(balanceRows.map((b) => [b.facilityId, Number(b.balance)]));

  const balances = allFacilities.map((f) => ({
    facilityId: f.id,
    facilityCode: f.code,
    facilityName: f.name,
    balance: balanceByFacility.get(f.id) ?? 0,
  }));

  const ledger = await db
    .select()
    .from(creditLedger)
    .orderBy(desc(creditLedger.createdAt))
    .limit(200);

  const facilityById = new Map(allFacilities.map((f) => [f.id, f]));
  const ledgerWithFacility = ledger.map((l) => ({
    ...l,
    facility: facilityById.get(l.facilityId) ?? null,
  }));

  return NextResponse.json({ balances, ledger: ledgerWithFacility });
}

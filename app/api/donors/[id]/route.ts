import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { donors, donorFamilyMembers, donorCreditLedger } from "@/lib/schema";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [donor] = await db.select().from(donors).where(eq(donors.id, id)).limit(1);
  if (!donor) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const familyMembers = await db
    .select()
    .from(donorFamilyMembers)
    .where(eq(donorFamilyMembers.donorId, id))
    .orderBy(desc(donorFamilyMembers.createdAt));

  const ledger = await db
    .select()
    .from(donorCreditLedger)
    .where(eq(donorCreditLedger.donorId, id))
    .orderBy(desc(donorCreditLedger.createdAt))
    .limit(50);

  const balance = ledger[0]?.balanceAfter ?? 0;

  return NextResponse.json({ donor, balance, familyMembers, ledger });
}

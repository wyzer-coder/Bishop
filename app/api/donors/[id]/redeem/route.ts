import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redeemCredit, RedemptionError } from "@/lib/domain/donor-credits";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { familyMemberId, unitId } = body as { familyMemberId?: string; unitId?: string };
  if (!familyMemberId || !unitId) {
    return NextResponse.json({ error: "familyMemberId and unitId are required" }, { status: 400 });
  }

  try {
    const result = await db.transaction((tx) =>
      redeemCredit(tx, { donorId: id, familyMemberId, unitId }),
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RedemptionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

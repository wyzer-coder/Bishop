import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addFamilyMember } from "@/lib/domain/donor-credits";

// POST /api/donors/[id]/family — add a family member, PENDING until they
// verify with the code this returns. The code itself is only ever handed
// back here (to the operator adding them) and re-entered by the family
// member — not something a stranger with just a phone number can supply.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { memberName, memberPhone } = body as { memberName?: string; memberPhone?: string };
  if (!memberName || !memberPhone) {
    return NextResponse.json({ error: "memberName and memberPhone are required" }, { status: 400 });
  }

  const link = await db.transaction((tx) => addFamilyMember(tx, { donorId: id, memberName, memberPhone }));
  return NextResponse.json({ familyMember: link });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyFamilyMember, VerificationError } from "@/lib/domain/donor-credits";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { linkId } = await params;
  const body = await req.json();
  const { code } = body as { code?: string };
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  try {
    const link = await db.transaction((tx) => verifyFamilyMember(tx, { familyMemberId: linkId, code }));
    return NextResponse.json({ familyMember: link });
  } catch (err) {
    if (err instanceof VerificationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

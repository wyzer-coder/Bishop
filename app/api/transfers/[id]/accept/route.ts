import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settleTransfer, OverdraftError } from "@/lib/domain/credits";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await db.transaction((tx) => settleTransfer(tx, id));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OverdraftError) {
      return NextResponse.json({ error: "OVERDRAFT_LIMIT", message: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to accept transfer";
    return NextResponse.json({ error: "ACCEPT_FAILED", message }, { status: 400 });
  }
}

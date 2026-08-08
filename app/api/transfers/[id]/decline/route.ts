import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { declineTransfer } from "@/lib/domain/credits";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await db.transaction((tx) => declineTransfer(tx, id));
    return NextResponse.json({ transfer: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to decline transfer";
    return NextResponse.json({ error: "DECLINE_FAILED", message }, { status: 400 });
  }
}

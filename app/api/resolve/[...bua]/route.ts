import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBua } from "@/lib/domain/protocol";

// ARCHITECTURE.md section 5A: resolve an address to live unit state.
// Clerk-protected (not in the ingest/allocate exclusion list).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bua: string[] }> },
) {
  const { bua } = await params;
  const buaString = bua.join("/");

  const resolved = await db.transaction((tx) => resolveBua(tx, buaString));
  if (!resolved) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(resolved);
}

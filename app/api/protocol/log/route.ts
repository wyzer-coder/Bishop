import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { allocationLog } from "@/lib/schema";

// ARCHITECTURE.md section 5A: recent allocation decisions with their reasons.
export async function GET() {
  const rows = await db
    .select()
    .from(allocationLog)
    .orderBy(desc(allocationLog.createdAt))
    .limit(50);
  return NextResponse.json({ log: rows });
}

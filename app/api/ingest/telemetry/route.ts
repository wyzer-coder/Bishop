import { NextResponse } from "next/server";

// Phase 4 (ARCHITECTURE.md section 9): device telemetry ingest.
// Unauthenticated by Clerk (excluded in middleware.ts); devices authenticate
// with X-Device-Key. Not yet implemented — schema.ts does not exist yet.
export async function POST() {
  return NextResponse.json(
    { error: "NOT_IMPLEMENTED" },
    { status: 501 },
  );
}

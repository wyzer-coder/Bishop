import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { donors, donorCreditLedger } from "@/lib/schema";
import { recordDonation } from "@/lib/domain/donor-credits";

// GET /api/donors?q=<name or phone> — search, for staff looking a donor up.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const rows = q
    ? await db
        .select()
        .from(donors)
        .where(or(ilike(donors.name, `%${q}%`), ilike(donors.phone, `%${q}%`)))
        .limit(20)
    : await db.select().from(donors).orderBy(desc(donors.createdAt)).limit(20);

  const withBalance = await Promise.all(
    rows.map(async (d) => {
      const [latest] = await db
        .select({ balanceAfter: donorCreditLedger.balanceAfter })
        .from(donorCreditLedger)
        .where(eq(donorCreditLedger.donorId, d.id))
        .orderBy(desc(donorCreditLedger.createdAt))
        .limit(1);
      return { ...d, balance: latest?.balanceAfter ?? 0 };
    }),
  );

  return NextResponse.json({ donors: withBalance });
}

// POST /api/donors — record a donation. Finds-or-creates the donor by
// phone. An optional rfidUid links a physical card to this donor, so a
// later tap of the same card is recognized automatically by
// POST /api/ingest/scan without re-asking for name/phone.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, phone, facilityId, rfidUid } = body as {
    name?: string;
    phone?: string;
    facilityId?: string;
    rfidUid?: string;
  };
  if (!name || !phone || !facilityId) {
    return NextResponse.json({ error: "name, phone and facilityId are required" }, { status: 400 });
  }

  try {
    const result = await db.transaction((tx) => recordDonation(tx, { name, phone, facilityId, rfidUid }));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json({ error: "This card is already linked to a different donor" }, { status: 409 });
    }
    throw err;
  }
}

import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { bloodUnits, custodyEvents, facilities } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { buaFor, verifyChain } from "@/lib/domain/protocol";
import { formatIST } from "@/lib/format";

// The page a phone camera lands on when it scans the QR printed on a unit's
// label. No sign-in — this route is carved out of Clerk middleware.
// Read-only, no donor identity: chain of custody only.
export default async function ScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [unit] = await db.select().from(bloodUnits).where(eq(bloodUnits.id, id)).limit(1);
  if (!unit) notFound();

  const [currentFacility] = await db
    .select({ code: facilities.code, name: facilities.name, city: facilities.city })
    .from(facilities)
    .where(eq(facilities.id, unit.currentFacilityId))
    .limit(1);

  const events = await db
    .select({
      id: custodyEvents.id,
      eventType: custodyEvents.eventType,
      occurredAt: custodyEvents.occurredAt,
      fromFacilityId: custodyEvents.fromFacilityId,
      toFacilityId: custodyEvents.toFacilityId,
    })
    .from(custodyEvents)
    .where(eq(custodyEvents.unitId, id))
    .orderBy(desc(custodyEvents.occurredAt));

  const allFacilities = await db.select().from(facilities);
  const facilityNameById = new Map(allFacilities.map((f) => [f.id, f.name]));

  const { valid: integrityValid } = await db.transaction((tx) => verifyChain(tx, id));
  const bua = currentFacility ? buaFor(unit, currentFacility) : null;
  const groupLabel = unit.bloodGroup.replace("_POS", "+").replace("_NEG", "-");

  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
          BishopOS · Provenance
        </p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          {groupLabel} {unit.component}
        </h1>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="font-mono text-sm tracking-tight">{unit.rfidUid}</p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                integrityValid
                  ? "bg-status-healthy/10 text-status-healthy"
                  : "bg-status-breach/10 text-status-breach"
              }`}
            >
              {integrityValid ? "Chain verified" : "Chain broken — unrouteable"}
            </span>
          </div>
          {bua && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{bua}</p>}

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <p>{unit.status.replace(/_/g, " ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Current facility</p>
              <p>{currentFacility?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{currentFacility?.city}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Collected</p>
              <p className="tabular-nums">{formatIST(unit.collectedAt)}</p>
            </div>
          </div>
        </div>

        <h2 className="mt-8 mb-3 text-sm font-semibold tracking-tight">Custody history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custody events recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-4 border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                <p className="text-sm font-medium">{e.eventType.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">
                  {e.fromFacilityId ? facilityNameById.get(e.fromFacilityId) : "—"}
                  {e.toFacilityId && e.toFacilityId !== e.fromFacilityId
                    ? ` → ${facilityNameById.get(e.toFacilityId)}`
                    : ""}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">{formatIST(e.occurredAt)}</p>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Scanned directly from this unit&apos;s label. No app, no account.
        </p>
      </div>
    </main>
  );
}

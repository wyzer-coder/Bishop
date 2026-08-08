// ARCHITECTURE.md section 6 + section 5A: run before the demo.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bloodUnits, transfers, creditLedger, allocationLog } from "@/lib/schema";
import { verifyChain } from "@/lib/domain/protocol";

let failures = 0;

function pass(label: string) {
  console.log(`  PASS  ${label}`);
}
function fail(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label} — ${detail}`);
}

async function main() {
  // 1. SUM(delta) = 0 across credit_ledger.
  const sumResult = await db.execute<{ sum: string }>(
    sql`SELECT COALESCE(SUM(delta), 0) as sum FROM credit_ledger`,
  );
  const sum = sumResult.rows[0].sum;
  if (Number(sum) === 0) {
    pass(`SUM(delta) = 0 across credit_ledger (${sum})`);
  } else {
    fail("SUM(delta) = 0 across credit_ledger", `got ${sum}`);
  }

  // 2. Every ACCEPTED transfer has exactly two ledger rows.
  const accepted = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(sql`${transfers.status} = 'ACCEPTED'`);
  let ledgerMismatch = 0;
  for (const t of accepted) {
    const rows = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(sql`${creditLedger.transferId} = ${t.id}`);
    if (rows.length !== 2) ledgerMismatch++;
  }
  if (ledgerMismatch === 0) {
    pass(`every ACCEPTED transfer has exactly two ledger rows (${accepted.length} checked)`);
  } else {
    fail("every ACCEPTED transfer has exactly two ledger rows", `${ledgerMismatch} of ${accepted.length} did not`);
  }

  // 3. verifyChain passes for every unit.
  const units = await db.select({ id: bloodUnits.id, rfidUid: bloodUnits.rfidUid }).from(bloodUnits);
  let brokenChains = 0;
  for (const u of units) {
    const { valid } = await db.transaction((tx) => verifyChain(tx, u.id));
    if (!valid) {
      brokenChains++;
      console.log(`        broken chain: ${u.rfidUid} (${u.id})`);
    }
  }
  if (brokenChains === 0) {
    pass(`verifyChain passes for every unit (${units.length} checked)`);
  } else {
    fail("verifyChain passes for every unit", `${brokenChains} of ${units.length} broken`);
  }

  // 4. No allocation in the log ever drew a reserved unit — scoped to
  // ROUTINE/URGENT. EMERGENCY is defined (ARCHITECTURE.md section 5A) as
  // drawing from local reserve on purpose; wasReserved: true there is the
  // feature working, not a violation of the pre-filter that ROUTINE/URGENT
  // must respect.
  const logRows = await db.select().from(allocationLog);
  let reservedDrawn = 0;
  for (const row of logRows) {
    if (row.priority === "EMERGENCY") continue;
    const results = row.results as { wasReserved: boolean; unitId: string }[];
    for (const r of results) {
      if (r.wasReserved) {
        reservedDrawn++;
        console.log(`        non-emergency allocation drew reserved unit ${r.unitId} (log ${row.id})`);
      }
    }
  }
  if (reservedDrawn === 0) {
    pass(`no ROUTINE/URGENT allocation ever drew a reserved unit (${logRows.length} log entries checked)`);
  } else {
    fail("no ROUTINE/URGENT allocation ever drew a reserved unit", `${reservedDrawn} violations`);
  }

  console.log(failures === 0 ? "\ncheck: all invariants pass" : `\ncheck: ${failures} invariant(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

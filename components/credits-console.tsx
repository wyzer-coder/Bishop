"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { formatIST } from "@/lib/format";

const OVERDRAFT_LIMIT = -5;

type Balance = { facilityId: string; facilityCode: string; facilityName: string; balance: number };
type LedgerRow = {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
  facility: { code: string; name: string } | null;
};

export function CreditsConsole() {
  const { data, isLoading } = useQuery<{ balances: Balance[]; ledger: LedgerRow[] }>({
    queryKey: ["credits"],
    queryFn: async () => {
      const res = await fetch("/api/credits");
      if (!res.ok) throw new Error("Failed to load credits");
      return res.json();
    },
  });

  const balances = data?.balances ?? [];
  const ledger = data?.ledger ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {balances.map((b) => (
          <div key={b.facilityId} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{b.facilityName}</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                b.balance <= OVERDRAFT_LIMIT ? "text-status-breach" : "text-credit"
              }`}
            >
              {b.balance > 0 ? "+" : ""}
              {b.balance}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">limit {OVERDRAFT_LIMIT}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.facility?.name ?? "—"}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.delta >= 0 ? "text-status-healthy" : "text-status-breach"}`}
                    >
                      {row.delta > 0 ? "+" : ""}
                      {row.delta}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-credit">{row.balanceAfter}</TableCell>
                    <TableCell className="text-muted-foreground">{row.reason}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatIST(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

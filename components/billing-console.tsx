"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatIST, formatRupees } from "@/lib/format";

type Facility = { id: string; code: string; name: string };
type Total = { code: string; count: number; amountPaise: number };
type Line = {
  id: string;
  code: string;
  description: string;
  amountPaise: number;
  createdAt: string;
  unitId: string | null;
  facility: { code: string; name: string } | null;
};

const CODE_LABEL: Record<string, string> = {
  COLD_CHAIN_STORAGE: "Cold-chain storage",
  NAT_TESTING: "NAT testing",
  COMPONENT_PREP: "Component prep",
  LAST_MILE_LOGISTICS: "Last-mile logistics",
  PLATFORM_SLA: "Platform SLA",
};

const PAGE_SIZE = 15;

export function BillingConsole() {
  const [facilityId, setFacilityId] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{
    facilities: Facility[];
    totals: Total[];
    lines: Line[];
    grandTotalPaise: number;
  }>({
    queryKey: ["billing", facilityId],
    queryFn: async () => {
      const url = facilityId === "ALL" ? "/api/billing" : `/api/billing?facility=${facilityId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load billing");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const facilities = data?.facilities ?? [];
  const totals = data?.totals ?? [];
  const lines = data?.lines ?? [];

  useEffect(() => {
    setPage(1);
  }, [facilityId]);

  const pageCount = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedLines = lines.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="All facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-xl font-semibold tabular-nums text-credit">
            {formatRupees(data?.grandTotalPaise ?? 0)}
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">By service</h2>
        {totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No billing lines for this facility.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {totals.map((t) => (
              <div key={t.code} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{CODE_LABEL[t.code] ?? t.code}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-credit">
                  {formatRupees(t.amountPaise)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t.count} lines</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Service lines</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No billing lines yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&>tr:nth-child(even)]:bg-muted/40">
                  {pagedLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Badge variant="secondary">{CODE_LABEL[l.code] ?? l.code}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.description}</TableCell>
                      <TableCell>{l.facility?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-credit">
                        {formatRupees(l.amountPaise)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{formatIST(l.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, lines.length)} of {lines.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </Button>
                <span className="tabular-nums text-muted-foreground">
                  {currentPage} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Blood is never invoiced. All charges are for cold chain, testing,
        logistics and platform services.
      </p>
    </div>
  );
}

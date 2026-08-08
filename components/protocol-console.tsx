"use client";

import { useQuery } from "@tanstack/react-query";
import { formatIST } from "@/lib/format";

type CostBreakdown = { distance: number; substitution: number; lastUnit: number; ttlSalvage: number };

type AllocationResult = {
  bua: string;
  unitId: string;
  rfidUid: string;
  heldAt: { code: string; name: string };
  distanceKm: number;
  etaMinutes: number;
  ttlHours: number;
  custodyVerified: boolean;
  coldChainIntact: boolean;
  creditCost: number;
  costBreakdown: CostBreakdown;
  reason: string;
  wasReserved: boolean;
};

type LogEntry = {
  id: string;
  priority: string;
  requestedGroup: string;
  requestedComponent: string;
  unitsRequested: number;
  lat: string;
  lng: string;
  results: AllocationResult[];
  replenishment: { transferId: string; etaMinutes: number } | null;
  createdAt: string;
};

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

function CostBar({ breakdown }: { breakdown: CostBreakdown }) {
  const segments = [
    { key: "distance", value: breakdown.distance, color: "var(--muted-foreground)" },
    { key: "substitution", value: breakdown.substitution, color: "var(--status-risk)" },
    { key: "lastUnit", value: breakdown.lastUnit, color: "var(--status-breach)" },
    { key: "ttlSalvage", value: Math.abs(breakdown.ttlSalvage), color: "var(--status-healthy)" },
  ];
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0) || 1;

  return (
    <div className="flex h-2 w-32 overflow-hidden rounded-sm bg-muted">
      {segments.map((seg) => (
        <div
          key={seg.key}
          style={{ width: `${(Math.abs(seg.value) / total) * 100}%`, backgroundColor: seg.color }}
          title={`${seg.key}: ${seg.value.toFixed(1)}`}
        />
      ))}
    </div>
  );
}

export function ProtocolConsole() {
  const { data, isLoading } = useQuery<{ log: LogEntry[] }>({
    queryKey: ["protocol-log"],
    queryFn: async () => {
      const res = await fetch("/api/protocol/log");
      if (!res.ok) throw new Error("Failed to load protocol log");
      return res.json();
    },
  });

  const entries = data?.log ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No allocation decisions yet. POST /api/allocate to see the network route a request.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
            <span className="tabular-nums text-muted-foreground">{formatIST(entry.createdAt)}</span>
            <span
              className={
                entry.priority === "EMERGENCY"
                  ? "text-status-breach"
                  : entry.priority === "URGENT"
                    ? "text-status-risk"
                    : "text-foreground"
              }
            >
              {entry.priority}
            </span>
            <span className="text-foreground">
              {entry.unitsRequested}x {groupLabel(entry.requestedGroup)} {entry.requestedComponent}
            </span>
            <span className="text-muted-foreground">
              @ {Number(entry.lat).toFixed(4)}, {Number(entry.lng).toFixed(4)}
            </span>
            {entry.replenishment && (
              <span className="text-status-risk">
                replenishment ETA {Math.round(entry.replenishment.etaMinutes)}m
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 pt-2">
            {entry.results.length === 0 && (
              <span className="text-status-breach">no candidates — request unfulfilled</span>
            )}
            {entry.results.map((r) => (
              <div key={r.unitId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                <span className="w-64 truncate text-foreground">{r.bua}</span>
                <CostBar breakdown={r.costBreakdown} />
                <span className="tabular-nums text-muted-foreground">
                  cost {r.creditCost.toFixed(1)} · {r.distanceKm.toFixed(1)}km · ETA {r.etaMinutes}m · TTL {r.ttlHours.toFixed(0)}h
                </span>
                <span className={r.custodyVerified ? "text-status-healthy" : "text-status-breach"}>
                  {r.custodyVerified ? "verified" : "INVALID CHAIN"}
                </span>
              </div>
            ))}
            {entry.results.map((r) => (
              <p key={`${r.unitId}-reason`} className="font-sans text-xs text-muted-foreground">
                {r.reason}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Droplet,
  AlertTriangle,
  Link2Off,
  Thermometer,
  Receipt,
  PackageCheck,
  Coins,
} from "lucide-react";
import { formatIST, formatRupees } from "@/lib/format";

type Facility = { id: string; code: string; name: string; city: string; type: "HUB" | "SPOKE" };
type Stats = {
  facilityCount: number;
  facilities: Facility[];
  totalUnits: number;
  unitsAtRisk: number;
  unitsUnroutable: number;
  openBreaches: number;
  creditPosition: {
    balances: { facilityId: string; code: string; name: string; balance: number }[];
    facilitiesInDeficit: number;
    facilitiesAtOverdraftLimit: number;
  };
  serviceRevenuePaiseThisMonth: number;
  wastageAverted: number;
};

type LogResult = { bua: string; reason: string; creditCost: number; distanceKm: number };
type LogEntry = {
  id: string;
  priority: string;
  requestedGroup: string;
  requestedComponent: string;
  createdAt: string;
  results: LogResult[];
};

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

type Accent = "neutral" | "risk" | "breach" | "healthy";

const ACCENT_CLASSES: Record<Accent, { text: string; chip: string }> = {
  neutral: { text: "text-primary", chip: "bg-primary/10 text-primary" },
  risk: { text: "text-status-risk", chip: "bg-status-risk/10 text-status-risk" },
  breach: { text: "text-status-breach", chip: "bg-status-breach/10 text-status-breach" },
  healthy: { text: "text-status-healthy", chip: "bg-status-healthy/10 text-status-healthy" },
};

function StatTile({
  label,
  value,
  icon: Icon,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
}) {
  const { text, chip } = ACCENT_CLASSES[accent];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-md ${chip}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${text}`}>{value}</p>
    </div>
  );
}

export function DashboardConsole() {
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const { data: logData } = useQuery<{ log: LogEntry[] }>({
    queryKey: ["protocol-log-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/protocol/log");
      if (!res.ok) throw new Error("Failed to load protocol log");
      return res.json();
    },
    refetchInterval: 4000,
  });

  if (statsLoading || !stats) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const recentAllocations = (logData?.log ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatTile label="Facilities" value={stats.facilityCount} icon={Building2} />
        <StatTile label="Total units" value={stats.totalUnits} icon={Droplet} />
        <StatTile label="At risk" value={stats.unitsAtRisk} icon={AlertTriangle} accent={stats.unitsAtRisk > 0 ? "risk" : "neutral"} />
        <StatTile label="Unroutable" value={stats.unitsUnroutable} icon={Link2Off} accent={stats.unitsUnroutable > 0 ? "breach" : "neutral"} />
        <StatTile label="Open breaches" value={stats.openBreaches} icon={Thermometer} accent={stats.openBreaches > 0 ? "breach" : "neutral"} />
        <StatTile label="Revenue (MTD)" value={formatRupees(stats.serviceRevenuePaiseThisMonth)} icon={Receipt} />
        <StatTile label="Wastage averted" value={stats.wastageAverted} icon={PackageCheck} accent="healthy" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-credit/10 text-credit">
              <Coins className="h-3.5 w-3.5" />
            </span>
            Network credit position
          </h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex gap-6 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{stats.creditPosition.facilitiesInDeficit}</span>{" "}
                <span className="text-muted-foreground">in deficit</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums text-status-breach">
                  {stats.creditPosition.facilitiesAtOverdraftLimit}
                </span>{" "}
                <span className="text-muted-foreground">at the -5 limit</span>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {stats.creditPosition.balances.map((b) => (
                <div key={b.facilityId} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{b.name}</span>
                  <span
                    className={`tabular-nums font-medium ${
                      b.balance <= -5 ? "text-status-breach" : "text-credit"
                    }`}
                  >
                    {b.balance > 0 ? "+" : ""}
                    {b.balance}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <h2 className="mt-6 mb-3 text-sm font-semibold tracking-tight">Facilities</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-2">
              {stats.facilities.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm">
                  <span>{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.type} · {f.city}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
              Source: data.gov.in, Blood Bank Directory, MoHFW
            </p>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Last 5 allocation decisions</h2>
          {recentAllocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No allocations yet — POST /api/allocate to see the network route a request.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentAllocations.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-card p-3 font-mono text-xs">
                  <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
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
                    <span>
                      {groupLabel(entry.requestedGroup)} {entry.requestedComponent}
                    </span>
                  </div>
                  {entry.results.slice(0, 1).map((r) => (
                    <p key={r.bua} className="mt-2 truncate font-sans text-muted-foreground">
                      {r.reason}
                    </p>
                  ))}
                  {entry.results.length === 0 && (
                    <p className="mt-2 font-sans text-status-breach">no candidates — request unfulfilled</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

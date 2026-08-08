"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatIST, formatISTTime } from "@/lib/format";

type LatestReading = { tempC: number; humidity: number | null; recordedAt: string; isBreach: boolean } | null;
type Device = {
  id: string;
  label: string;
  kind: "SCANNER" | "FRIDGE" | "SHIPPER";
  facilityId: string;
  facilityName: string;
  lastSeenAt: string | null;
  latestReading: LatestReading;
};
type Series = { deviceId: string; deviceLabel: string; readings: { recordedAt: string; tempC: number }[] };
type BreachUnit = { unitId: string; rfidUid: string; bloodGroup: string; component: string };
type FacilityAmbient = { id: string; name: string; city: string | null; ambientC: number | null };
type Breach = {
  id: string;
  deviceId: string;
  deviceLabel: string;
  facilityName: string;
  startedAt: string;
  peakTempC: number;
  unitsAffected: number;
  note: string | null;
  units: BreachUnit[];
};

const LINE_COLORS = ["#1B2A4A", "#5B4B8A", "#2F7A4F", "#B8860B", "#B03A3A", "#3A6EA5", "#8A4B5B"];

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

function transportRisk(ambientC: number | null): { label: string; className: string } {
  if (ambientC === null) return { label: "No data", className: "text-muted-foreground" };
  if (ambientC >= 35) return { label: "High", className: "text-status-breach" };
  if (ambientC >= 28) return { label: "Moderate", className: "text-status-risk" };
  return { label: "Low", className: "text-status-healthy" };
}

function StatusDot({ device }: { device: Device }) {
  const color = !device.latestReading
    ? "bg-muted-foreground/40"
    : device.latestReading.isBreach
      ? "bg-status-breach"
      : "bg-status-healthy";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

export function ColdChainConsole() {
  const { data, isLoading } = useQuery<{
    devices: Device[];
    series: Series[];
    breaches: Breach[];
    facilities: FacilityAmbient[];
  }>({
    queryKey: ["coldchain"],
    queryFn: async () => {
      const res = await fetch("/api/coldchain");
      if (!res.ok) throw new Error("Failed to load cold chain data");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const devices = data?.devices ?? [];
  const series = data?.series ?? [];
  const breaches = data?.breaches ?? [];
  const facilityAmbient = data?.facilities ?? [];

  // Recharts wants one array of points, each with a key per series.
  const chartData = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const s of series) {
      for (const r of s.readings) {
        const key = r.recordedAt;
        if (!byTime.has(key)) byTime.set(key, { recordedAt: key });
        byTime.get(key)![s.deviceId] = r.tempC;
      }
    }
    return [...byTime.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [series]);

  const fridgeSeries = series.filter((s) => (chartData.some((d) => s.deviceId in d)));

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Devices</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices seeded.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {devices.map((d) => (
              <div key={d.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{d.label}</p>
                  <StatusDot device={d} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.kind} · {d.facilityName}
                </p>
                {d.latestReading ? (
                  <p
                    className={`mt-2 text-xl font-semibold tabular-nums ${
                      d.latestReading.isBreach ? "text-status-breach" : "text-foreground"
                    }`}
                  >
                    {d.latestReading.tempC.toFixed(1)}°C
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No reading in 24h</p>
                )}
                {d.latestReading && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatIST(d.latestReading.recordedAt)}
                    {d.latestReading.humidity !== null ? ` · ${d.latestReading.humidity.toFixed(0)}% RH` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Transport risk (ambient conditions)</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Ambient temperature at each facility, from Open-Meteo at seed time.
          Higher ambient temperature means a bigger gap for a shipper to
          fight during last-mile transport, so it is shown here as a risk
          indicator, not a cold-chain reading itself.
        </p>
        {facilityAmbient.length === 0 ? (
          <p className="text-sm text-muted-foreground">No facility data.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facilityAmbient.map((f) => {
              const risk = transportRisk(f.ambientC);
              return (
                <div key={f.id} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-sm font-medium">{f.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.city ?? "—"}</p>
                  <div className="mt-2 flex items-baseline justify-between">
                    <p className="text-xl font-semibold tabular-nums">
                      {f.ambientC !== null ? `${f.ambientC.toFixed(1)}°C` : "—"}
                    </p>
                    <span className={`text-xs font-medium ${risk.className}`}>{risk.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Temperature, last 24 hours
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Shaded band is the 2–6°C safe range for whole blood and packed red
          cells, the components most fridges here hold.
        </p>
        <div className="h-80 rounded-lg border border-border bg-card p-4">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No telemetry in the last 24 hours. Send a reading from /simulator.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="recordedAt"
                  tickFormatter={(v) => formatISTTime(v)}
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis tick={{ fontSize: 11 }} unit="°C" domain={["dataMin - 3", "dataMax + 3"]} />
                <Tooltip
                  labelFormatter={(v) => formatIST(v as string)}
                  formatter={(value, name) => [`${Number(value).toFixed(1)}°C`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceArea y1={2} y2={6} fill="var(--status-healthy)" fillOpacity={0.08} />
                {fridgeSeries.map((s, i) => (
                  <Line
                    key={s.deviceId}
                    type="monotone"
                    dataKey={s.deviceId}
                    name={s.deviceLabel}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Breaches ({breaches.length})
        </h2>
        {breaches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No breaches recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Peak °C</TableHead>
                  <TableHead>Units affected</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breaches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.deviceLabel}</TableCell>
                    <TableCell>{b.facilityName}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatIST(b.startedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums text-status-breach">
                      {b.peakTempC.toFixed(1)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="destructive">{b.unitsAffected}</Badge>
                        {b.units.map((u) => (
                          <Link key={u.unitId} href={`/units/${u.unitId}`}>
                            <Badge variant="outline" className="font-mono hover:bg-muted">
                              {groupLabel(u.bloodGroup)} {u.component}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{b.note}</TableCell>
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

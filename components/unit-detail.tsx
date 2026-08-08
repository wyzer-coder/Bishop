"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ProvenanceQr } from "@/components/provenance-qr";
import { STORAGE_RANGE, type Component, type UnitStatus } from "@/lib/domain/units";
import { formatIST, formatISTTime } from "@/lib/format";

type Facility = { id: string; code: string; name: string; type: "HUB" | "SPOKE" };

type UnitDetailResponse = {
  unit: {
    id: string;
    rfidUid: string;
    donorRef: string;
    bloodGroup: string;
    component: Component;
    status: UnitStatus;
    natTested: boolean;
    collectedAt: string;
    quarantineReason: string | null;
    currentFacility: Facility | null;
    originFacility: Facility | null;
  };
  custodyEvents: {
    id: string;
    eventType: string;
    occurredAt: string;
    fromFacilityName: string | null;
    toFacilityName: string | null;
    deviceLabel: string | null;
  }[];
  telemetry: { recordedAt: string; tempC: string; isBreach: boolean }[];
};

const BADGE_VARIANT: Record<
  UnitStatus,
  "default" | "secondary" | "destructive" | "outline" | "healthy" | "risk"
> = {
  COLLECTED: "outline",
  TESTING: "outline",
  AVAILABLE: "healthy",
  RESERVED: "secondary",
  IN_TRANSIT: "risk",
  ISSUED: "secondary",
  TRANSFUSED: "healthy",
  QUARANTINED: "destructive",
  EXPIRED: "destructive",
  DISCARDED: "destructive",
};

export function UnitDetail({ unitId }: { unitId: string }) {
  const { data, isLoading } = useQuery<UnitDetailResponse>({
    queryKey: ["unit", unitId],
    queryFn: async () => {
      const res = await fetch(`/api/units/${unitId}`);
      if (!res.ok) throw new Error("Failed to load unit");
      return res.json();
    },
  });

  const range = data ? STORAGE_RANGE[data.unit.component] : null;
  const chartBand = useMemo(() => {
    if (!range) return null;
    const maxC = Number.isFinite(range.maxC as number) ? (range.maxC as number) : (range.minC as number) + 15;
    const minC = Number.isFinite(range.minC) ? range.minC : maxC - 15;
    return { minC, maxC };
  }, [range]);

  const chartData = useMemo(
    () =>
      (data?.telemetry ?? []).map((t) => ({
        time: formatISTTime(t.recordedAt),
        tempC: Number(t.tempC),
        isBreach: t.isBreach,
      })),
    [data],
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Unit not found.</p>;
  }

  const { unit, custodyEvents } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-lg tracking-tight">{unit.rfidUid}</p>
              <Badge variant={BADGE_VARIANT[unit.status]} className="text-sm">
                {unit.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {unit.bloodGroup.replace("_POS", "+").replace("_NEG", "-")} ·{" "}
              {unit.component} · donor {unit.donorRef}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ProvenanceQr unitId={unit.id} size={96} />
            <p className="text-center text-[11px] text-muted-foreground">Label QR</p>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Current facility</p>
            <p>{unit.currentFacility?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Origin</p>
            <p>{unit.originFacility?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Collected</p>
            <p className="tabular-nums">{formatIST(unit.collectedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">NAT tested</p>
            <p>{unit.natTested ? "Yes" : "No"}</p>
          </div>
        </div>
        {unit.quarantineReason && (
          <p className="mt-4 text-sm text-status-breach">
            Quarantined: {unit.quarantineReason}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold tracking-tight">
            Custody timeline
          </h2>
          {custodyEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custody events yet.</p>
          ) : (
            <ol className="flex flex-col gap-4 border-l border-border pl-4">
              {custodyEvents.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-sm font-medium">{e.eventType.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.fromFacilityName ?? "—"}
                    {e.toFacilityName && e.toFacilityName !== e.fromFacilityName
                      ? ` → ${e.toFacilityName}`
                      : ""}
                    {e.deviceLabel ? ` · ${e.deviceLabel}` : ""}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatIST(e.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold tracking-tight">
            Cold-chain telemetry
          </h2>
          {chartData.length === 0 || !chartBand ? (
            <p className="text-sm text-muted-foreground">
              No telemetry recorded yet for this unit&apos;s facility.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[chartBand.minC - 5, chartBand.maxC + 5]}
                />
                <Tooltip />
                <ReferenceArea
                  y1={chartBand.minC}
                  y2={chartBand.maxC}
                  fill="var(--status-healthy)"
                  fillOpacity={0.08}
                  stroke="none"
                />
                <Line
                  type="monotone"
                  dataKey="tempC"
                  stroke="var(--navy)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

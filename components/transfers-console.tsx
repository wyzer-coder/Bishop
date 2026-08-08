"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { isAtRisk, remainingHours, type Component, type UnitStatus } from "@/lib/domain/units";
import { formatIST } from "@/lib/format";

type InventoryUnit = {
  id: string;
  rfidUid: string;
  bloodGroup: string;
  component: Component;
  status: UnitStatus;
  collectedAt: string;
  currentFacilityId: string;
  facilityCode: string;
  facilityName: string;
};

type Transfer = {
  id: string;
  status: string;
  credits: number;
  reason: string;
  createdAt: string;
  unitRfidUid: string;
  unitBloodGroup: string;
  unitComponent: string;
  offeringFacility: { id: string; name: string } | null;
  receivingFacility: { id: string; name: string } | null;
};

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

export function TransfersConsole() {
  const queryClient = useQueryClient();
  const now = useMemo(() => new Date(), []);

  const { data: unitsData } = useQuery<{ units: InventoryUnit[] }>({
    queryKey: ["inventory"],
    queryFn: async () => {
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
  });
  const { data: transfersData } = useQuery<{ transfers: Transfer[] }>({
    queryKey: ["transfers"],
    queryFn: async () => {
      const res = await fetch("/api/transfers");
      if (!res.ok) throw new Error("Failed to load transfers");
      return res.json();
    },
  });

  const units = useMemo(() => unitsData?.units ?? [], [unitsData]);
  const allTransfers = transfersData?.transfers ?? [];
  const pending = allTransfers.filter((t) => t.status === "SUGGESTED" || t.status === "REQUESTED");
  const resolved = allTransfers.filter((t) => t.status !== "SUGGESTED" && t.status !== "REQUESTED");

  const atRiskUnits = units.filter((u) =>
    isAtRisk({ status: u.status, component: u.component, collectedAt: new Date(u.collectedAt) }, now),
  );

  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of units) map.set(u.currentFacilityId, u.facilityName);
    return [...map.entries()];
  }, [units]);

  const [selectedFacility, setSelectedFacility] = useState<Record<string, string>>({});

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["transfers"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  async function requestTransfer(unit: InventoryUnit) {
    const receivingFacilityId = selectedFacility[unit.id];
    if (!receivingFacilityId) return toast.error("Pick a receiving facility first");
    if (receivingFacilityId === unit.currentFacilityId) return toast.error("Pick a different facility");

    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: unit.id, receivingFacilityId }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error(json.error ?? "Request failed");
    toast.success(`Transfer requested for ${unit.rfidUid}`);
    refresh();
  }

  async function accept(transfer: Transfer) {
    const res = await fetch(`/api/transfers/${transfer.id}/accept`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) return toast.error(json.message ?? json.error ?? "Accept failed");
    toast.success(
      `Accepted — ${transfer.offeringFacility?.name} +${transfer.credits}, ${transfer.receivingFacility?.name} -${transfer.credits}`,
    );
    refresh();
  }

  async function decline(transfer: Transfer) {
    const res = await fetch(`/api/transfers/${transfer.id}/decline`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) return toast.error(json.message ?? json.error ?? "Decline failed");
    toast.success(`Declined transfer for ${transfer.unitRfidUid}`);
    refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          At-risk units ({atRiskUnits.length})
        </h2>
        {atRiskUnits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units currently inside their risk window.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {atRiskUnits.map((u) => {
              const hours = remainingHours({ component: u.component, collectedAt: new Date(u.collectedAt) }, now);
              return (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <span className="font-mono">{u.rfidUid}</span>
                  <span>{groupLabel(u.bloodGroup)} {u.component}</span>
                  <span className="text-status-risk tabular-nums">{Math.round(hours)}h remaining</span>
                  <span className="text-muted-foreground">{u.facilityName}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Select
                      value={selectedFacility[u.id] ?? ""}
                      onValueChange={(v) => setSelectedFacility((s) => ({ ...s, [u.id]: v }))}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Receiving facility" />
                      </SelectTrigger>
                      <SelectContent>
                        {facilityOptions
                          .filter(([id]) => id !== u.currentFacilityId)
                          .map(([id, name]) => (
                            <SelectItem key={id} value={id}>
                              {name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => requestTransfer(u)}>
                      Request transfer
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Pending transfers ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending transfer requests.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">{t.unitRfidUid}</span>
                  <span>{groupLabel(t.unitBloodGroup)} {t.unitComponent}</span>
                  <Badge variant="secondary">{t.status}</Badge>
                  <span className="text-muted-foreground">
                    {t.offeringFacility?.name} → {t.receivingFacility?.name}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>
                <p className="mt-1 text-xs text-credit">
                  If accepted: {t.offeringFacility?.name} +{t.credits} credit,{" "}
                  {t.receivingFacility?.name} -{t.credits} credit.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => accept(t)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decline(t)}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Resolved</h2>
          <div className="flex flex-col gap-1">
            {resolved.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono">{t.unitRfidUid}</span>
                <Badge variant="outline">{t.status}</Badge>
                <span>{t.offeringFacility?.name} → {t.receivingFacility?.name}</span>
                <span className="tabular-nums">{formatIST(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

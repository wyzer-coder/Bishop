"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Facility = { id: string; name: string; type: "HUB" | "SPOKE" };
type ScanRow = { createdAt: string } | null;

export function ScannerLocationBar() {
  const qc = useQueryClient();

  const { data: locationData } = useQuery<{ facilityId: string | null }>({
    queryKey: ["scanner-location"],
    queryFn: async () => {
      const res = await fetch("/api/scanner-location");
      if (!res.ok) throw new Error("Failed to load scanner location");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const { data: facilitiesData } = useQuery<{ facilities: Facility[] }>({
    queryKey: ["facilities-list"],
    queryFn: async () => {
      const res = await fetch("/api/facilities");
      if (!res.ok) throw new Error("Failed to load facilities");
      return res.json();
    },
  });

  // Same queryKey ScanWatcher polls with — TanStack Query dedupes this to
  // one network request every 1500ms, not two.
  const { data: scanData } = useQuery<{ scan: ScanRow }>({
    queryKey: ["scans-latest"],
    queryFn: async () => {
      const res = await fetch("/api/scans/latest");
      if (!res.ok) throw new Error("Failed to poll scans");
      return res.json();
    },
    refetchInterval: 1500,
  });

  const facilities = facilitiesData?.facilities ?? [];
  const live =
    !!scanData?.scan && Date.now() - new Date(scanData.scan.createdAt).getTime() <= 30000;

  async function changeLocation(facilityId: string) {
    await fetch("/api/scanner-location", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId }),
    });
    qc.invalidateQueries({ queryKey: ["scanner-location"] });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Scanner at</span>
      <Select value={locationData?.facilityId ?? undefined} onValueChange={changeLocation}>
        <SelectTrigger className="h-8 w-[220px] text-sm">
          <SelectValue placeholder="Select facility" />
        </SelectTrigger>
        <SelectContent>
          {facilities.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className={`h-2 w-2 rounded-full ${live ? "bg-status-healthy" : "bg-muted-foreground/40"}`}
        />
        {live ? "Scanner live" : "Scanner idle"}
      </span>
    </div>
  );
}

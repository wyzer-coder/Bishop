"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import {
  BLOOD_GROUPS,
  COMPONENTS,
  UNIT_STATUSES,
  isAtRisk,
  remainingHours,
  type Component,
  type UnitStatus,
} from "@/lib/domain/units";

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

const ALL = "ALL";

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

function formatCountdown(hours: number) {
  if (hours <= 0) return "Expired";
  const totalSeconds = Math.floor(hours * 3600);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: All</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InventoryTable() {
  const searchParams = useSearchParams();

  const { data, isLoading } = useQuery<{ units: InventoryUnit[] }>({
    queryKey: ["inventory"],
    queryFn: async () => {
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to load inventory");
      return res.json();
    },
  });

  // One shared clock for every row's countdown, ticked once a second, rather
  // than a setInterval per row.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Pre-selects the facility filter when arriving from a link elsewhere in
  // the app (e.g. "View inventory" from a marker on /map).
  const [facility, setFacility] = useState(() => searchParams.get("facility") ?? ALL);
  const [bloodGroup, setBloodGroup] = useState(ALL);
  const [component, setComponent] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const units = useMemo(() => data?.units ?? [], [data]);

  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of units) map.set(u.currentFacilityId, u.facilityName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [units]);

  const filtered = units.filter((u) => {
    if (facility !== ALL && u.currentFacilityId !== facility) return false;
    if (bloodGroup !== ALL && u.bloodGroup !== bloodGroup) return false;
    if (component !== ALL && u.component !== component) return false;
    if (status !== ALL && u.status !== status) return false;
    return true;
  });

  useEffect(() => {
    setPage(1);
  }, [facility, bloodGroup, component, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Facility"
          value={facility}
          onChange={setFacility}
          options={facilityOptions.map(([id, name]) => ({
            value: id,
            label: name,
          }))}
        />
        <FilterSelect
          label="Blood group"
          value={bloodGroup}
          onChange={setBloodGroup}
          options={BLOOD_GROUPS.map((g) => ({
            value: g,
            label: g.replace("_POS", "+").replace("_NEG", "-"),
          }))}
        />
        <FilterSelect
          label="Component"
          value={component}
          onChange={setComponent}
          options={COMPONENTS.map((c) => ({ value: c, label: c }))}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={UNIT_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {filtered.length} of {units.length} units
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>RFID UID</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Facility</TableHead>
              <TableHead className="text-right">Expires in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/40">
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground"
                >
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground"
                >
                  No units match these filters.
                </TableCell>
              </TableRow>
            )}
            {paged.map((u) => {
              const collectedAt = new Date(u.collectedAt);
              const hours = remainingHours(
                { component: u.component, collectedAt },
                now,
              );
              const atRisk = isAtRisk(
                { status: u.status, component: u.component, collectedAt },
                now,
              );
              const expired = hours <= 0;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-sm">
                    <Link
                      href={`/units/${u.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {u.rfidUid}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {u.bloodGroup.replace("_POS", "+").replace("_NEG", "-")}
                  </TableCell>
                  <TableCell>{u.component}</TableCell>
                  <TableCell>
                    <Badge variant={BADGE_VARIANT[u.status]}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{u.facilityName}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      expired
                        ? "text-status-breach"
                        : atRisk
                          ? "text-status-risk"
                          : "text-foreground"
                    }`}
                  >
                    {formatCountdown(hours)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
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
      )}
    </div>
  );
}

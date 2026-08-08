"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { UnitAddress } from "@/components/design/unit-address";
import { TTLRing } from "@/components/design/ttl-ring";
import { CustodyChain, type CustodyChainEvent } from "@/components/design/custody-chain";
import { AllocationScore } from "@/components/design/allocation-score";

const TOKEN_SWATCHES: { name: string; className: string }[] = [
  { name: "blood-50", className: "bg-blood-50" },
  { name: "blood-100", className: "bg-blood-100" },
  { name: "blood-200", className: "bg-blood-200" },
  { name: "blood-400", className: "bg-blood-400" },
  { name: "blood-600", className: "bg-blood-600" },
  { name: "blood-700", className: "bg-blood-700" },
  { name: "blood-900", className: "bg-blood-900" },
  { name: "plasma-100", className: "bg-plasma-100" },
  { name: "plasma-500", className: "bg-plasma-500" },
  { name: "plasma-700", className: "bg-plasma-700" },
  { name: "cryo-100", className: "bg-cryo-100" },
  { name: "cryo-500", className: "bg-cryo-500" },
  { name: "cryo-700", className: "bg-cryo-700" },
  { name: "verified-500", className: "bg-verified-500" },
  { name: "warn-500", className: "bg-warn-500" },
  { name: "alert-500", className: "bg-alert-500" },
];

const CHAIN_EVENTS: CustodyChainEvent[] = [
  {
    id: "1",
    eventType: "COLLECTED",
    occurredAt: "2026-07-01T04:12:00Z",
    actorLabel: "PMCH Blood Bank",
    hashPrefix: "9f3a1c02…",
    verified: true,
  },
  {
    id: "2",
    eventType: "TEST_PASSED",
    occurredAt: "2026-07-01T09:40:00Z",
    actorLabel: "Lab scanner 1",
    hashPrefix: "2b77e910…",
    verified: true,
  },
  {
    id: "3",
    eventType: "SCANNED_OUT",
    occurredAt: "2026-07-03T14:02:00Z",
    actorLabel: "Hub Scanner 1",
    hashPrefix: "aa019cf4…",
    verified: false,
  },
  {
    id: "4",
    eventType: "SCANNED_IN",
    occurredAt: "2026-07-03T16:55:00Z",
    actorLabel: "SNCM Fridge 1",
    hashPrefix: "0000000…",
    verified: false,
  },
];

export function DesignReview() {
  const { theme, setTheme } = useTheme();
  const [selectedGroup, setSelectedGroup] = useState("O_POS");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">/design</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Dev-only review route (Pass 1 — foundation). Not linked from nav, not shipped to
            production.
          </p>
        </div>
        <Button variant="outline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          Toggle theme ({theme ?? "system"})
        </Button>
      </div>

      {/* ─── Color tokens ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-heading text-lg font-semibold text-ink">Tokens</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {TOKEN_SWATCHES.map((s) => (
            <div key={s.name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-lg border border-line ${s.className}`} />
              <span className="font-mono text-[11px] text-ink-muted">{s.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Type ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-heading text-lg font-semibold text-ink">Type</h2>
        <div className="flex flex-col gap-4">
          <p className="font-heading text-5xl font-extrabold tracking-tight text-ink">
            Archivo 800 — <span className="text-blood-600">the address</span>
          </p>
          <p className="max-w-xl text-lg text-ink">
            Inter Tight — Blood is a perishable, partially-substitutable asset that moves between
            institutions which do not trust each other.
          </p>
          <p className="font-mono text-sm tabular-nums text-ink">
            JetBrains Mono — bua:SPK-DHN-SNCM/O_POS/PRBC/04A3B2C1 · 9f3a1c02e7b4 · 31.23
          </p>
        </div>
      </section>

      {/* ─── Base primitives ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-heading text-lg font-semibold text-ink">Primitives</h2>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG", "AB_POS", "AB_NEG"].map((g) => (
              <Chip
                key={g}
                variant={
                  selectedGroup === g
                    ? g.startsWith("O") || g.startsWith("AB")
                      ? "rareSelected"
                      : "selected"
                    : g.startsWith("O") || g.startsWith("AB")
                      ? "rare"
                      : "default"
                }
                onClick={() => setSelectedGroup(g)}
              >
                {g.replace("_POS", "+").replace("_NEG", "-")}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="healthy">AVAILABLE</Badge>
            <Badge variant="risk">IN TRANSIT</Badge>
            <Badge variant="destructive">QUARANTINED</Badge>
            <Badge variant="credit">+6 cr</Badge>
            <Badge variant="outline">COLLECTED</Badge>
          </div>

          <Input placeholder="bua:… or facility code" className="max-w-xs" />

          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>SAI Hospital Blood Bank</CardTitle>
              <CardDescription>Bokaro Steel City · SPOKE</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-muted">Radius check: 8px cards, 4px controls.</p>
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-lg border border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead className="text-right">TTL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono">O+</TableCell>
                  <TableCell>PRBC</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">19d 04h</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>

          <Button variant="outline" onClick={() => toast.success("Allocated")}>
            Fire a toast
          </Button>
        </div>
      </section>

      {/* ─── Signature elements ────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-heading text-lg font-semibold text-ink">Signature elements</h2>

        <div className="flex flex-col gap-10">
          <div>
            <p className="mb-2 font-mono text-xs text-ink-muted uppercase">UnitAddress</p>
            <UnitAddress bua="bua:SPK-DHN-SNCM/O_POS/PRBC/04A3B2C1" size="lg" />
          </div>

          <div>
            <p className="mb-2 font-mono text-xs text-ink-muted uppercase">TTLRing</p>
            <div className="flex items-center gap-6">
              <TTLRing remainingHours={456} totalHours={1008} />
              <TTLRing remainingHours={38} totalHours={1008} />
              <TTLRing remainingHours={6} totalHours={1008} />
              <TTLRing remainingHours={0} totalHours={1008} />
            </div>
          </div>

          <div>
            <p className="mb-2 font-mono text-xs text-ink-muted uppercase">CustodyChain — vertical</p>
            <CustodyChain events={CHAIN_EVENTS} orientation="vertical" />
          </div>

          <div>
            <p className="mb-2 font-mono text-xs text-ink-muted uppercase">CustodyChain — horizontal</p>
            <CustodyChain events={CHAIN_EVENTS} orientation="horizontal" />
          </div>

          <div>
            <p className="mb-2 font-mono text-xs text-ink-muted uppercase">AllocationScore</p>
            <div className="max-w-md rounded-xl border border-line bg-paper p-4">
              <AllocationScore distance={15.0} substitution={12.4} ttlSalvage={-58.9} lastUnit={30} total={-31.23} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

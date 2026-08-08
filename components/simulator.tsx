"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type InventoryUnit = {
  id: string;
  rfidUid: string;
  bloodGroup: string;
  component: string;
  status: string;
};

type Device = {
  id: string;
  label: string;
  kind: "SCANNER" | "FRIDGE" | "SHIPPER";
  deviceKey: string;
  facilityId: string;
  facilityName: string;
};

async function postIngest(
  path: "scan" | "telemetry",
  deviceKey: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`/api/ingest/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Key": deviceKey },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export function Simulator() {
  const queryClient = useQueryClient();

  const { data: unitsData } = useQuery<{ units: InventoryUnit[] }>({
    queryKey: ["inventory"],
    queryFn: async () => {
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
  });
  const { data: devicesData } = useQuery<{ devices: Device[] }>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices");
      if (!res.ok) throw new Error("Failed to load devices");
      return res.json();
    },
  });

  const units = useMemo(() => unitsData?.units ?? [], [unitsData]);
  const devices = useMemo(() => devicesData?.devices ?? [], [devicesData]);

  const [rfidUid, setRfidUid] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [tempC, setTempC] = useState(4);
  const [breachStep, setBreachStep] = useState<number | null>(null);

  const device = devices.find((d) => d.id === deviceId) ?? null;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["unit"] });
  }

  async function handleTap() {
    if (!device) return toast.error("Select a device first");
    if (!rfidUid) return toast.error("Enter or pick an RFID UID");
    // No `action` — the scanner infers direction from the unit's current
    // state and where "Scanner at" (top bar) says it is right now. The
    // resulting dialog or toast comes from ScanWatcher (mounted once in the
    // app shell), not from here, so this doesn't await/handle the response
    // beyond a hard network failure.
    const { ok, status, json } = await postIngest("scan", device.deviceKey, { rfidUid });
    if (!ok && status !== 404) {
      toast.error(json.error ?? "Tap failed");
    }
  }

  async function handleScan(action: "IN" | "OUT") {
    if (!device) return toast.error("Select a device first");
    if (!rfidUid) return toast.error("Enter or pick an RFID UID");
    const { ok, status, json } = await postIngest("scan", device.deviceKey, {
      rfidUid,
      action,
      ts: new Date().toISOString(),
    });
    if (!ok) {
      toast.error(
        status === 404
          ? `Unknown tag: ${rfidUid}`
          : (json.error ?? "Scan failed"),
      );
      return;
    }
    toast.success(`Scanned ${action} at ${device.label} — unit is now ${json.unit.status}`);
    refresh();
  }

  async function handleSendReading() {
    if (!device) return toast.error("Select a device first");
    const { ok, json } = await postIngest("telemetry", device.deviceKey, {
      tempC,
      humidity: 50,
      shipmentId: null,
      ts: new Date().toISOString(),
    });
    if (!ok) {
      toast.error(json.error ?? "Reading failed");
      return;
    }
    toast.success(
      json.breach
        ? `Reading sent — BREACH detected at ${device.label}`
        : `Reading sent — ${tempC}°C at ${device.label}`,
    );
    refresh();
  }

  async function handleSimulateBreach() {
    if (!device) return toast.error("Select a device first");
    const readings = [12.0, 12.4, 11.8];
    for (let i = 0; i < readings.length; i++) {
      setBreachStep(i + 1);
      const { ok, json } = await postIngest("telemetry", device.deviceKey, {
        tempC: readings[i],
        humidity: 60,
        shipmentId: null,
        ts: new Date().toISOString(),
      });
      if (!ok) {
        toast.error(json.error ?? "Breach simulation failed");
        setBreachStep(null);
        return;
      }
      if (json.breach) {
        toast.error(
          `Cold-chain breach at ${device.label} — units quarantined`,
        );
        refresh();
        setBreachStep(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    setBreachStep(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-status-risk/40 bg-status-risk/10 px-4 py-3 text-sm text-status-risk">
        Hardware-free demo path. This page posts the exact same payloads the
        ESP32 firmware would — no scanner or sensor required.
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Device</h2>
        <Select value={deviceId} onValueChange={setDeviceId}>
          <SelectTrigger className="w-full sm:w-[360px]">
            <SelectValue placeholder="Select a device" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.label} ({d.kind}) — {d.facilityName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">RFID scan</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={rfidUid}
            onChange={(e) => setRfidUid(e.target.value.toUpperCase())}
            placeholder="RFID UID"
            className="font-mono sm:w-[220px]"
          />
          <Select value={rfidUid} onValueChange={setRfidUid}>
            <SelectTrigger className="w-full sm:w-[320px]">
              <SelectValue placeholder="Or pick a seeded unit" />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.rfidUid}>
                  {u.rfidUid} — {u.bloodGroup.replace("_POS", "+").replace("_NEG", "-")}{" "}
                  {u.component} ({u.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button onClick={handleTap}>Tap</Button>
            <Button variant="outline" onClick={() => handleScan("IN")}>
              Scan IN
            </Button>
            <Button variant="outline" onClick={() => handleScan("OUT")}>
              Scan OUT
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Tap</strong> is a real card tap — direction is inferred automatically from
          the unit&apos;s state and wherever &ldquo;Scanner at&rdquo; (top bar) currently is. An
          unregistered UID opens the new-unit dialog; a known one moves and shows a toast.
          Scan IN / Scan OUT below force an explicit direction instead, ignoring the inference.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">
          Temperature reading
        </h2>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={-30}
              max={30}
              step={0.5}
              value={tempC}
              onChange={(e) => setTempC(Number(e.target.value))}
              className="w-full max-w-md accent-primary"
            />
            <span className="w-16 text-right text-sm tabular-nums">
              {tempC.toFixed(1)}°C
            </span>
          </div>
          <div>
            <Button onClick={handleSendReading}>Send reading</Button>
          </div>
        </div>

        <Separator className="my-6" />

        <div>
          <Button variant="destructive" onClick={handleSimulateBreach} disabled={breachStep !== null}>
            {breachStep ? `Simulating breach (${breachStep}/3)…` : "Simulate cold-chain breach"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Sends three consecutive out-of-range readings from the selected
            device and quarantines every affected unit on hand there.
          </p>
        </div>
      </div>
    </div>
  );
}

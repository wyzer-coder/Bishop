"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { BLOOD_GROUPS, COMPONENTS, SHELF_LIFE_DAYS, type BloodGroup, type Component } from "@/lib/domain/units";

type ScanRow = {
  id: string;
  rfidUid: string;
  outcome: string;
  detail: string | null;
  unitId: string | null;
  facilityId: string | null;
  facilityName: string | null;
  handled: boolean;
  createdAt: string;
};

type RegistrationStep = "choice" | "unit" | "donor";

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

function randomDonorRef() {
  return `DNR-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
}

function toDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScanWatcher() {
  const qc = useQueryClient();
  const lastSeenId = useRef<string | null>(null);
  const [dialogScan, setDialogScan] = useState<ScanRow | null>(null);
  const [step, setStep] = useState<RegistrationStep>("choice");

  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O_POS");
  const [component, setComponent] = useState<Component>("PRBC");
  const [donorRef, setDonorRef] = useState("");
  const [collectedAt, setCollectedAt] = useState("");

  const [donorName, setDonorName] = useState("");
  const [donorPhone, setDonorPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const { data } = useQuery<{ scan: ScanRow | null }>({
    queryKey: ["scans-latest"],
    queryFn: async () => {
      const res = await fetch("/api/scans/latest");
      if (!res.ok) throw new Error("Failed to poll scans");
      return res.json();
    },
    refetchInterval: 1500,
  });

  const applyPreset = (preset: "fresh" | "ageing" | "near-expiry", comp: Component) => {
    const shelfMs = SHELF_LIFE_DAYS[comp] * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let target: number;
    if (preset === "fresh") target = now;
    else if (preset === "ageing") target = now - shelfMs * 0.6;
    else target = now - (shelfMs - 38 * 60 * 60 * 1000);
    setCollectedAt(toDatetimeLocal(new Date(target)));
  };

  useEffect(() => {
    const scan = data?.scan;
    if (!scan) return;
    if (scan.id === lastSeenId.current) return;
    lastSeenId.current = scan.id;

    if (scan.outcome === "UNKNOWN_TAG" && !scan.handled) {
      setDialogScan(scan);
      setStep("choice");
      setBloodGroup("O_POS");
      setComponent("PRBC");
      setDonorRef(randomDonorRef());
      applyPreset("fresh", "PRBC");
      setDonorName("");
      setDonorPhone("");
      return;
    }

    if (scan.outcome === "MOVED_OUT") {
      toast.success(`${scan.rfidUid} dispatched from ${scan.facilityName ?? "facility"}`);
    } else if (scan.outcome === "MOVED_IN") {
      toast.success(`${scan.rfidUid} received at ${scan.facilityName ?? "facility"}`);
    } else if (scan.outcome === "NO_CHANGE") {
      toast(`${scan.rfidUid} unchanged. ${scan.detail ?? ""}`);
    } else if (scan.outcome === "DONOR_THANKS") {
      toast.success(scan.detail ?? "Thank you for donating blood!");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function markHandled(scanId: string) {
    await fetch(`/api/scans/${scanId}/handle`, { method: "POST" });
  }

  async function handleCancel() {
    if (dialogScan) await markHandled(dialogScan.id);
    setDialogScan(null);
    setStep("choice");
  }

  async function handleRegisterUnit() {
    if (!dialogScan || !dialogScan.facilityId) return;
    if (!donorRef || !collectedAt) {
      toast.error("Fill in every field first");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfidUid: dialogScan.rfidUid,
          bloodGroup,
          component,
          donorRef,
          collectedAt: new Date(collectedAt).toISOString(),
          facilityId: dialogScan.facilityId,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Failed to register unit");
        setSubmitting(false);
        return;
      }
      await markHandled(dialogScan.id);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["facilities-map"] });
      toast.success(`Registered ${dialogScan.rfidUid}`);
      setDialogScan(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterDonor() {
    if (!dialogScan || !dialogScan.facilityId) return;
    if (!donorName || !donorPhone) {
      toast.error("Enter a name and phone number first");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/donors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: donorName,
          phone: donorPhone,
          facilityId: dialogScan.facilityId,
          rfidUid: dialogScan.rfidUid,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to register donor");
        setSubmitting(false);
        return;
      }
      await markHandled(dialogScan.id);
      qc.invalidateQueries({ queryKey: ["donors-search"] });
      toast.success(
        `Thank you ${donorName} for donating blood! You now have ${json.balance} credit${json.balance === 1 ? "" : "s"}.`,
      );
      setDialogScan(null);
    } finally {
      setSubmitting(false);
    }
  }

  const shelfDays = useMemo(() => SHELF_LIFE_DAYS[component], [component]);

  return (
    <Dialog open={!!dialogScan} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        {step === "choice" && (
          <>
            <DialogHeader>
              <DialogTitle>New tag detected</DialogTitle>
              <DialogDescription>
                This RFID tag isn&apos;t registered yet. What was scanned?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground">RFID UID</label>
                <p className="mt-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                  {dialogScan?.rfidUid}
                </p>
              </div>
              <Button onClick={() => setStep("unit")}>New blood unit</Button>
              <Button variant="outline" onClick={() => setStep("donor")}>
                New donor
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "unit" && (
          <>
            <DialogHeader>
              <DialogTitle>New unit detected</DialogTitle>
              <DialogDescription>
                Fill in the unit&apos;s details to add it to inventory at the scanner&apos;s
                current location.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground">RFID UID</label>
                <p className="mt-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                  {dialogScan?.rfidUid}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Blood group</label>
                  <Select value={bloodGroup} onValueChange={(v) => setBloodGroup(v as BloodGroup)}>
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOOD_GROUPS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {groupLabel(g)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Component</label>
                  <Select
                    value={component}
                    onValueChange={(v) => {
                      const c = v as Component;
                      setComponent(c);
                      applyPreset("fresh", c);
                    }}
                  >
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPONENTS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Donor reference</label>
                <Input value={donorRef} onChange={(e) => setDonorRef(e.target.value)} className="mt-1" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">
                  Collected at — shelf life {shelfDays}d
                </label>
                <div className="mt-1 flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("fresh", component)}>
                    Fresh
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("ageing", component)}>
                    Ageing
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset("near-expiry", component)}
                  >
                    Near expiry
                  </Button>
                </div>
                <input
                  type="datetime-local"
                  value={collectedAt}
                  onChange={(e) => setCollectedAt(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Facility</label>
                <p className="mt-1 rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {dialogScan?.facilityName ?? "—"}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choice")} disabled={submitting}>
                Back
              </Button>
              <Button onClick={handleRegisterUnit} disabled={submitting}>
                {submitting ? "Registering…" : "Register unit"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "donor" && (
          <>
            <DialogHeader>
              <DialogTitle>New donor</DialogTitle>
              <DialogDescription>
                Registers this card to a donor. They&apos;ll get one family credit now, and
                every future tap of this same card adds another — redeemable by a verified
                family member instead of searching for a donor. See the Family Credits tab.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground">RFID UID</label>
                <p className="mt-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                  {dialogScan?.rfidUid}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Donor name</label>
                <Input value={donorName} onChange={(e) => setDonorName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Phone</label>
                <Input value={donorPhone} onChange={(e) => setDonorPhone(e.target.value)} className="mt-1" />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choice")} disabled={submitting}>
                Back
              </Button>
              <Button onClick={handleRegisterDonor} disabled={submitting}>
                {submitting ? "Registering…" : "Thank donor & give credit"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

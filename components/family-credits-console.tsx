"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { BLOOD_GROUPS, COMPONENTS } from "@/lib/domain/units";
import { formatIST } from "@/lib/format";

type Facility = { id: string; name: string; type: "HUB" | "SPOKE" };
type Donor = { id: string; name: string; phone: string; balance: number };
type FamilyMember = {
  id: string;
  memberName: string;
  memberPhone: string;
  status: "PENDING" | "VERIFIED";
  verificationCode: string;
};
type DonorDetail = {
  donor: { id: string; name: string; phone: string };
  balance: number;
  familyMembers: FamilyMember[];
  ledger: { id: string; delta: number; balanceAfter: number; reason: string; createdAt: string }[];
};

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

export function FamilyCreditsConsole() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedDonorId, setSelectedDonorId] = useState<string | null>(null);

  // Record a donation
  const [donorName, setDonorName] = useState("");
  const [donorPhone, setDonorPhone] = useState("");
  const [facilityId, setFacilityId] = useState("");

  // Add family member
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [lastIssuedCode, setLastIssuedCode] = useState<{ name: string; code: string } | null>(null);

  // Verify
  const [verifyCodes, setVerifyCodes] = useState<Record<string, string>>({});

  // Redeem
  const [redeemGroup, setRedeemGroup] = useState<Record<string, string>>({});
  const [redeemComponent, setRedeemComponent] = useState<Record<string, string>>({});

  const { data: facilitiesData } = useQuery<{ facilities: Facility[] }>({
    queryKey: ["facilities-list"],
    queryFn: async () => {
      const res = await fetch("/api/facilities");
      if (!res.ok) throw new Error("Failed to load facilities");
      return res.json();
    },
  });
  const facilities = facilitiesData?.facilities ?? [];

  const { data: searchResults } = useQuery<{ donors: Donor[] }>({
    queryKey: ["donors-search", search],
    queryFn: async () => {
      const res = await fetch(`/api/donors?q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error("Failed to search donors");
      return res.json();
    },
  });

  const { data: donorDetail, refetch: refetchDonor } = useQuery<DonorDetail>({
    queryKey: ["donor", selectedDonorId],
    queryFn: async () => {
      const res = await fetch(`/api/donors/${selectedDonorId}`);
      if (!res.ok) throw new Error("Failed to load donor");
      return res.json();
    },
    enabled: !!selectedDonorId,
  });

  async function submitDonation() {
    if (!donorName || !donorPhone || !facilityId) {
      toast.error("Name, phone and facility are all required");
      return;
    }
    const res = await fetch("/api/donors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: donorName, phone: donorPhone, facilityId }),
    });
    if (!res.ok) {
      toast.error("Failed to record donation");
      return;
    }
    const data = await res.json();
    toast.success(`${donorName} now has ${data.balance} credit${data.balance === 1 ? "" : "s"}`);
    setDonorName("");
    setDonorPhone("");
    setSelectedDonorId(data.donor.id);
    qc.invalidateQueries({ queryKey: ["donors-search"] });
  }

  async function submitFamilyMember() {
    if (!selectedDonorId || !memberName || !memberPhone) {
      toast.error("Name and phone are required");
      return;
    }
    const res = await fetch(`/api/donors/${selectedDonorId}/family`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberName, memberPhone }),
    });
    if (!res.ok) {
      toast.error("Failed to add family member");
      return;
    }
    const data = await res.json();
    setLastIssuedCode({ name: memberName, code: data.familyMember.verificationCode });
    setMemberName("");
    setMemberPhone("");
    refetchDonor();
  }

  async function submitVerify(linkId: string) {
    if (!selectedDonorId) return;
    const code = verifyCodes[linkId];
    if (!code) {
      toast.error("Enter the code");
      return;
    }
    const res = await fetch(`/api/donors/${selectedDonorId}/family/${linkId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Verification failed");
      return;
    }
    toast.success("Family member verified");
    refetchDonor();
  }

  async function submitRedeem(link: FamilyMember) {
    if (!selectedDonorId) return;
    const group = redeemGroup[link.id];
    const component = redeemComponent[link.id];
    if (!group || !component) {
      toast.error("Pick a blood group and component");
      return;
    }
    const invRes = await fetch(
      `/api/inventory?status=AVAILABLE&bloodGroup=${group}&component=${component}`,
    );
    const invData = await invRes.json();
    const unit = invData.units?.[0];
    if (!unit) {
      toast.error("No matching unit available right now");
      return;
    }
    const res = await fetch(`/api/donors/${selectedDonorId}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyMemberId: link.id, unitId: unit.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Redemption failed");
      return;
    }
    toast.success(`Issued ${groupLabel(group)} ${component} to ${link.memberName} — 1 credit used`);
    refetchDonor();
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Record a donation</h2>
          <div className="flex flex-col gap-2">
            <Input placeholder="Donor name" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
            <Input placeholder="Phone" value={donorPhone} onChange={(e) => setDonorPhone(e.target.value)} />
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger>
                <SelectValue placeholder="Facility" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={submitDonation}>Record donation (+1 credit)</Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Find a donor</h2>
          <Input placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-3 flex flex-col gap-1">
            {(searchResults?.donors ?? []).map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDonorId(d.id)}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedDonorId === d.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                <span>
                  {d.name} <span className="text-xs opacity-70">{d.phone}</span>
                </span>
                <Badge variant={selectedDonorId === d.id ? "outline" : "credit"}>{d.balance} cr</Badge>
              </button>
            ))}
            {searchResults && searchResults.donors.length === 0 && (
              <p className="text-sm text-muted-foreground">No donors found.</p>
            )}
          </div>
        </div>
      </div>

      <div>
        {!selectedDonorId || !donorDetail ? (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Record a donation or search for a donor to see their family credits.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold tracking-tight">{donorDetail.donor.name}</p>
                  <p className="text-xs text-muted-foreground">{donorDetail.donor.phone}</p>
                </div>
                <Badge variant="credit" className="text-sm">
                  {donorDetail.balance} credit{donorDetail.balance === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="mb-3 text-sm font-semibold tracking-tight">Family members</h3>
              {donorDetail.familyMembers.length === 0 && (
                <p className="mb-3 text-sm text-muted-foreground">No family members added yet.</p>
              )}
              <div className="flex flex-col gap-3">
                {donorDetail.familyMembers.map((m) => (
                  <div key={m.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">
                        {m.memberName} <span className="text-xs text-muted-foreground">{m.memberPhone}</span>
                      </span>
                      <Badge variant={m.status === "VERIFIED" ? "healthy" : "risk"}>{m.status}</Badge>
                    </div>
                    {m.status === "PENDING" && (
                      <div className="mt-2 flex gap-2">
                        <Input
                          placeholder="6-digit code"
                          value={verifyCodes[m.id] ?? ""}
                          onChange={(e) => setVerifyCodes((s) => ({ ...s, [m.id]: e.target.value }))}
                          className="h-8"
                        />
                        <Button size="sm" onClick={() => submitVerify(m.id)}>
                          Verify
                        </Button>
                      </div>
                    )}
                    {m.status === "VERIFIED" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Select
                          value={redeemGroup[m.id] ?? ""}
                          onValueChange={(v) => setRedeemGroup((s) => ({ ...s, [m.id]: v }))}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue placeholder="Group" />
                          </SelectTrigger>
                          <SelectContent>
                            {BLOOD_GROUPS.map((g) => (
                              <SelectItem key={g} value={g}>
                                {groupLabel(g)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={redeemComponent[m.id] ?? ""}
                          onValueChange={(v) => setRedeemComponent((s) => ({ ...s, [m.id]: v }))}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue placeholder="Component" />
                          </SelectTrigger>
                          <SelectContent>
                            {COMPONENTS.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={() => submitRedeem(m)} disabled={donorDetail.balance <= 0}>
                          Redeem 1 credit
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Add a family member
              </h4>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Name"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  className="h-8 flex-1"
                />
                <Input
                  placeholder="Phone"
                  value={memberPhone}
                  onChange={(e) => setMemberPhone(e.target.value)}
                  className="h-8 flex-1"
                />
                <Button size="sm" onClick={submitFamilyMember}>
                  Add
                </Button>
              </div>
              {lastIssuedCode && (
                <p className="mt-2 rounded-md bg-credit/10 px-3 py-2 text-xs text-credit">
                  Code for {lastIssuedCode.name}: <span className="font-mono font-semibold">{lastIssuedCode.code}</span>{" "}
                  — share this with them in person to verify the link.
                </p>
              )}
            </div>

            {donorDetail.ledger.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold tracking-tight">History</h3>
                <div className="flex flex-col gap-1 text-xs">
                  {donorDetail.ledger.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-muted-foreground">
                      <span>{l.reason}</span>
                      <span className={l.delta > 0 ? "text-status-healthy" : "text-status-breach"}>
                        {l.delta > 0 ? "+" : ""}
                        {l.delta}
                      </span>
                      <span className="tabular-nums">{formatIST(l.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

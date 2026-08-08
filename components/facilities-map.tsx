"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CircleDot, TriangleAlert } from "lucide-react";
import { loadGoogleMaps } from "@/lib/load-google-maps";

type Facility = {
  id: string;
  code: string;
  name: string;
  type: "HUB" | "SPOKE";
  city: string;
  lat: number;
  lng: number;
  beds: number | null;
  ambientC: number | null;
  unitsOnHand: number;
  unitsAtRisk: number;
};

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

// Dhanbad district, roughly centered between the seeded facilities.
const CENTER = { lat: 23.78, lng: 86.43 };

function markerColor(f: Facility) {
  if (f.type === "HUB") return "#1b2a4a"; // navy
  if (f.unitsAtRisk > 0) return "#b8860b"; // amber
  return "#2f7a4f"; // green
}

const LEGEND = [
  {
    icon: Building2,
    color: "text-primary bg-primary/10",
    label: "Hub",
    body: "The network's central facility. Reserve floors are largest here, and it's the fallback replenishment source for EMERGENCY requests.",
  },
  {
    icon: CircleDot,
    color: "text-status-healthy bg-status-healthy/10",
    label: "Spoke, no units at risk",
    body: "A collection or transfusion point with nothing inside the 72-hour wastage window right now.",
  },
  {
    icon: TriangleAlert,
    color: "text-status-risk bg-status-risk/10",
    label: "Spoke, units at risk",
    body: "Has at least one unit inside the wastage window — a candidate the matching engine should be redistributing. Check /transfers.",
  },
];

export function FacilitiesMap() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [billingBlocked, setBillingBlocked] = useState(false);

  const { data } = useQuery<{ facilities: Facility[] }>({
    queryKey: ["facilities-map"],
    queryFn: async () => {
      const res = await fetch("/api/facilities");
      if (!res.ok) throw new Error("Failed to load facilities");
      return res.json();
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!API_KEY) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    loadGoogleMaps(API_KEY)
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        mapRef.current = new google.maps.Map(mapDivRef.current, {
          center: CENTER,
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          // A Map ID means Cloud-based styling (the "light theme" picked in
          // Cloud Console) — passing a local `styles` array alongside it is
          // ignored and logs a console warning, so only fall back to it
          // when there's no Map ID configured.
          ...(MAP_ID ? { mapId: MAP_ID } : { styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }] }),
        });
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Google renders its own ugly "can't load Google Maps correctly" overlay
  // (class gm-err-container) directly into the map div when the project has
  // no billing account attached — there's no supported callback for this
  // specific error, so we watch for that element and swap in our own
  // message instead of Google's.
  useEffect(() => {
    if (status !== "ready" || !mapDivRef.current) return;
    const el = mapDivRef.current;
    const observer = new MutationObserver(() => {
      if (el.querySelector(".gm-err-container")) {
        setBillingBlocked(true);
      }
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [status]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !data) return;
    const infoWindow = new google.maps.InfoWindow();
    const markers = data.facilities.map((f) => {
      const marker = new google.maps.Marker({
        position: { lat: f.lat, lng: f.lng },
        map: mapRef.current!,
        title: f.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: f.type === "HUB" ? 10 : 7,
          fillColor: markerColor(f),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => {
        infoWindow.setContent(`
          <div style="font-family: Inter, system-ui, sans-serif; padding: 2px; min-width: 200px;">
            <p style="font-size: 13px; font-weight: 600; color: #1f2430; margin: 0 0 2px;">${f.name}</p>
            <p style="font-size: 11px; color: #6b6f76; margin: 0 0 8px;">${f.type} · ${f.city}</p>
            <div style="font-size: 12px; color: #1f2430; display: flex; flex-direction: column; gap: 2px;">
              <span>Units on hand: <strong>${f.unitsOnHand}</strong></span>
              <span>At risk: <strong style="color: ${f.unitsAtRisk > 0 ? "#b8860b" : "#1f2430"}">${f.unitsAtRisk}</strong></span>
              ${f.ambientC !== null ? `<span>Ambient: <strong>${f.ambientC.toFixed(1)}°C</strong></span>` : ""}
              ${f.beds !== null ? `<span>Beds: <strong>${f.beds}</strong></span>` : ""}
            </div>
            <a href="/inventory?facility=${f.id}" style="display: inline-block; margin-top: 10px; font-size: 12px; color: #1b2a4a; font-weight: 500; text-decoration: underline;">
              View inventory →
            </a>
          </div>
        `);
        infoWindow.open({ map: mapRef.current!, anchor: marker });
      });
      return marker;
    });
    return () => {
      markers.forEach((m) => m.setMap(null));
    };
  }, [status, data]);

  if (!API_KEY || status === "error") {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm font-medium">Map unavailable</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Add <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to{" "}
          <code className="font-mono">.env.local</code> to enable the network map (Maps
          JavaScript API, enabled in Google Cloud Console).
        </p>
      </div>
    );
  }

  const facilities = data?.facilities ?? [];
  const totalUnits = facilities.reduce((sum, f) => sum + f.unitsOnHand, 0);
  const totalAtRisk = facilities.reduce((sum, f) => sum + f.unitsAtRisk, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Facilities</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{facilities.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Units on hand</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{totalUnits}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">At risk network-wide</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${totalAtRisk > 0 ? "text-status-risk" : ""}`}>
            {totalAtRisk}
          </p>
        </div>
      </div>

      <div className="relative">
        <div ref={mapDivRef} className="h-96 w-full rounded-lg border border-border" />
        {billingBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm font-medium">Google Maps billing not enabled</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              This Google Cloud project doesn&apos;t have a billing account attached yet.
              The Maps JavaScript API needs one even to stay within the free monthly
              credit — add one in Google Cloud Console, then reload this page.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {LEGEND.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card p-3">
            <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-md ${item.color}`}>
              <item.icon className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold tracking-tight">{item.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

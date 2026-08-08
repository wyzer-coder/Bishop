// ARCHITECTURE.md section 5B item 6: real facility data from the data.gov.in
// Blood Bank Directory (Ministry of Health & Family Welfare, NDSAP).
//
// ABSOLUTE RULE: this module is imported ONLY by scripts/seed.ts. Nothing
// under /app may import it — there is no third-party HTTP call in any
// request path. Polled routes stay fast and don't depend on an external
// government API being up.
//
// The live API is best-effort. If it's unreachable, returns a non-2xx
// status, times out, or simply doesn't have enough rows with usable
// lat/lng, this falls back to the committed snapshot at
// lib/data/facilities.snapshot.json and logs a clear warning — seeding must
// never fail because api.data.gov.in is down.
import snapshot from "@/lib/data/facilities.snapshot.json";

const RESOURCE_ID =
  process.env.DATA_GOV_IN_BLOOD_BANK_RESOURCE_ID ?? "5a072473-9245-4b91-8b17-e91b7f0bf485";
const API_BASE = "https://api.data.gov.in/resource";
const FETCH_TIMEOUT_MS = 6000;

export type GovFacility = {
  role: "HUB" | "SPOKE";
  code: string;
  name: string;
  city: string;
  lat: string;
  lng: string;
  beds: number | null;
};

type RawRecord = {
  state?: string;
  district?: string;
  city?: string;
  hospname?: string;
  h_name?: string;
  address?: string;
  latitude?: string | number;
  longitude?: string | number;
  lat?: string | number;
  lng?: string | number;
};

function isValidCoord(lat: unknown, lng: unknown): lat is string {
  const la = Number(lat);
  const lo = Number(lng);
  // Rough India bounding box — rejects the "NA"/blank/zero values that fill
  // almost every row of the 2015 dataset (see facilities.snapshot.json note).
  return (
    Number.isFinite(la) &&
    Number.isFinite(lo) &&
    la > 6 &&
    la < 36 &&
    lo > 68 &&
    lo < 98
  );
}

async function fetchLive(state: string, city: string): Promise<GovFacility[]> {
  const apiKey = process.env.DATA_GOV_IN_KEY;
  if (!apiKey) {
    throw new Error("DATA_GOV_IN_KEY not set");
  }

  const url = new URL(`${API_BASE}/${RESOURCE_ID}`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "200");
  url.searchParams.set("filters[state]", state);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`data.gov.in responded ${res.status}`);
  }
  const json = await res.json();
  const records: RawRecord[] = Array.isArray(json?.records) ? json.records : [];

  const cityMatches = records.filter((r) => {
    const rowCity = (r.city ?? r.district ?? "").toString().toLowerCase();
    return rowCity.includes(city.toLowerCase());
  });

  const withCoords = cityMatches.filter((r) =>
    isValidCoord(r.latitude ?? r.lat, r.longitude ?? r.lng),
  );

  if (withCoords.length === 0) {
    throw new Error(`No ${city} rows with valid lat/lng in live response`);
  }

  return withCoords.slice(0, 5).map((r, i) => ({
    role: i === 0 ? "HUB" : "SPOKE",
    code: `${i === 0 ? "HUB" : "SPK"}-${city.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, "0")}`,
    name: (r.hospname ?? r.h_name ?? "Unnamed facility").toString(),
    city,
    lat: String(r.latitude ?? r.lat),
    lng: String(r.longitude ?? r.lng),
    beds: null,
  }));
}

function fromSnapshot(): GovFacility[] {
  return snapshot.facilities.map((f) => ({
    role: f.role as "HUB" | "SPOKE",
    code: f.code,
    name: f.name,
    city: f.city,
    lat: f.lat,
    lng: f.lng,
    beds: f.beds,
  }));
}

/**
 * Real facility data for the demo network. Tries the live data.gov.in Blood
 * Bank Directory first; falls back to the committed snapshot on any
 * failure. Called once, at seed time, from scripts/seed.ts only.
 */
export async function loadRealFacilities(
  state: string,
  city: string,
): Promise<{ facilities: GovFacility[]; source: "live" | "snapshot" }> {
  try {
    const facilities = await fetchLive(state, city);
    console.log(`govdata: loaded ${facilities.length} live facilities from data.gov.in`);
    return { facilities, source: "live" };
  } catch (err) {
    console.warn(
      `govdata: data.gov.in fetch failed (${err instanceof Error ? err.message : String(err)}) — falling back to lib/data/facilities.snapshot.json`,
    );
    return { facilities: fromSnapshot(), source: "snapshot" };
  }
}

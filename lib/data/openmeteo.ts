// ARCHITECTURE.md section 5B item 7 (optional): ambient temperature at each
// facility's coordinates, from Open-Meteo — no API key required.
//
// ABSOLUTE RULE, same as lib/data/govdata.ts: imported ONLY by
// scripts/seed.ts. No request path calls a third-party API. Best-effort —
// a failed or slow fetch returns null per facility and is logged, never
// thrown; seeding must never fail because a weather API is unreachable.
const FETCH_TIMEOUT_MS = 4000;

export async function fetchAmbientC(lat: number, lng: number): Promise<number | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`open-meteo responded ${res.status}`);
    const json = await res.json();
    const temp = json?.current?.temperature_2m;
    return typeof temp === "number" ? temp : null;
  } catch (err) {
    console.warn(
      `openmeteo: fetch failed for ${lat},${lng} (${err instanceof Error ? err.message : String(err)}) — leaving ambient_c null`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

import { headers } from "next/headers";
import { CopyButton } from "@/components/copy-button";

export default async function DocsPage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const curl = `curl -X POST ${baseUrl}/api/allocate \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Key: DEV-HUB-SCANNER-01" \\
  -d '{
    "group": "O_POS",
    "component": "PRBC",
    "units": 1,
    "lat": 23.780744,
    "lng": 86.419480,
    "priority": "ROUTINE"
  }'`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API documentation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          One endpoint. Give it what you need and where you are; it tells you
          which unit, where it is, and how it decided.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">
            <span className="rounded bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
              POST
            </span>{" "}
            <span className="font-mono">/api/allocate</span>
          </h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Authenticated with an{" "}
          <code className="font-mono text-xs">X-Device-Key</code> header, the
          same as device ingest — no browser session required. Excluded from
          Clerk middleware.
        </p>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Request body
        </h3>
        <pre className="mb-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
{`{
  "group": "A_POS" | "A_NEG" | "B_POS" | "B_NEG" | "O_POS" | "O_NEG" | "AB_POS" | "AB_NEG",
  "component": "WHOLE" | "PRBC" | "PLATELET" | "PLASMA",
  "units": number,
  "lat": number,
  "lng": number,
  "neededBy"?: string,
  "priority"?: "ROUTINE" | "URGENT" | "EMERGENCY"  // defaults to ROUTINE
}`}
        </pre>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Response — one object per allocated unit
        </h3>
        <pre className="mb-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
{`{
  "results": [{
    "bua": "bua:<facility_code>/<group>/<component>/<rfid_uid>",
    "unitId": string,
    "rfidUid": string,
    "heldAt": { "code": string, "name": string, "lat": string, "lng": string },
    "distanceKm": number,
    "etaMinutes": number,
    "etaBasis": string,
    "ttlHours": number,
    "custodyVerified": boolean,
    "coldChainIntact": boolean,
    "creditCost": number,
    "costBreakdown": { "distance": number, "substitution": number, "lastUnit": number, "ttlSalvage": number },
    "reason": string,
    "wasReserved": boolean
  }],
  "replenishment"?: { "transferId": string, "etaMinutes": number }  // EMERGENCY only
}`}
        </pre>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Try it
        </h3>
        <div className="flex items-start gap-3">
          <pre className="flex-1 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {curl}
          </pre>
          <CopyButton text={curl} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The coordinates above are 2 km from SPK-DHN-SNCM (S.N. Chokrabarty
          Memorial Nursing Home Blood Bank, Dhanbad) — a real, seeded
          facility, not a placeholder. An exact O+ match sits there with 22
          days remaining; the network allocates an O- unit from SAI Hospital
          Blood Bank in Bokaro Steel City, 30 km away, with 38 hours
          remaining instead. Run it to see why.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
            GET
          </span>{" "}
          <span className="font-mono">/api/resolve/[...bua]</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Resolve a Bishop Unit Address back to live unit state: TTL, custody
          integrity, cold-chain status, and whether it&apos;s currently
          routable. Clerk-protected.
        </p>
      </section>
    </div>
  );
}

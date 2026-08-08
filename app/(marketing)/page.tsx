import Link from "next/link";
import { Network, ShieldCheck, Coins, Route } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "Bishop Unit Address",
    body: "Every unit gets a routable address derived from its RFID tag, group, component and current facility — bua:SPK-DHN-SNCM/O_POS/PRBC/04A3B2C1. It changes when the unit moves, exactly like an IP.",
    icon: Network,
    accent: "text-primary bg-primary/10",
  },
  {
    title: "Custody hash chain",
    body: "Every state change writes a chained, cryptographically verified event. A broken chain drops the unit from allocation and is reported, never hidden.",
    icon: ShieldCheck,
    accent: "text-status-healthy bg-status-healthy/10",
  },
  {
    title: "Blood Credits",
    body: "Inter-facility transfers settle in a non-monetary, non-convertible credit ledger. Double-entry, reciprocal, capped at a -5 overdraft. No rupee ever prices a unit of blood.",
    icon: Coins,
    accent: "text-credit bg-credit/10",
  },
  {
    title: "One allocation call",
    body: "POST /allocate returns the single unit, anywhere in the network, whose allocation costs the network least — weighing distance, rarity, shelf life and network resilience in one number.",
    icon: Route,
    accent: "text-status-risk bg-status-risk/10",
  },
];

export default function MarketingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-6 py-16 text-foreground">
      <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary">
          Dhanbad · Jharkhand network pilot
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          BishopOS
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          The operating system for a blood-supply network: real-time
          inventory, RFID-verified chain of custody, cold-chain monitoring,
          and a non-monetary Blood Credit market that makes inter-facility
          transfer possible — built on real Dhanbad-area blood banks, not
          placeholder data.
        </p>
        <p className="max-w-2xl border-l-2 border-primary/30 pl-4 text-left text-sm text-muted-foreground italic">
          Blood is a perishable, partially-substitutable asset that moves
          between institutions which do not trust each other. No inventory
          system can model that — which is why every existing platform can
          only answer &ldquo;does this hospital have O+?&rdquo; BishopOS gives every
          unit of blood a routable address and a time-to-live, and exposes
          one call that returns the single unit, anywhere in the network,
          whose allocation costs the network least.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-up">Sign up</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/docs">API docs →</Link>
          </Button>
        </div>
      </div>

      <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-card p-5 text-left shadow-sm">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-md ${f.accent}`}>
              <f.icon className="h-4.5 w-4.5" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-16 max-w-2xl text-center text-xs text-muted-foreground">
        Facility data: data.gov.in Blood Bank Directory, Ministry of Health
        &amp; Family Welfare. Blood is never priced, invoiced or sold —
        every rupee in this system attaches to a service, never to the
        biological product.
      </p>
    </main>
  );
}

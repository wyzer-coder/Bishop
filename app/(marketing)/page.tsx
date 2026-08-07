import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MarketingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        BishopOS
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        The operating system for a blood-supply network: real-time inventory,
        RFID-verified chain of custody, cold-chain monitoring, and a
        non-monetary Blood Credit market that makes inter-facility transfer
        possible.
      </p>
      <Button asChild>
        <Link href="/dashboard">Sign in</Link>
      </Button>
    </main>
  );
}

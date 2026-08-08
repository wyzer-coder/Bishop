"use client";

import { cn } from "@/lib/utils";

// Prop names match /api/allocate's real costBreakdown shape exactly
// (distance, substitution, lastUnit, ttlSalvage) so this wires straight
// onto the live response with no translation layer — the plain-English
// labels below (distance / rarity / shelf life / network resilience) are
// presentation only.
export type AllocationScoreProps = {
  distance: number;
  substitution: number;
  lastUnit: number;
  ttlSalvage: number;
  total: number;
  className?: string;
};

const ROWS: { key: keyof Omit<AllocationScoreProps, "total" | "className">; label: string }[] = [
  { key: "distance", label: "distance" },
  { key: "substitution", label: "rarity" },
  { key: "ttlSalvage", label: "shelf life" },
  { key: "lastUnit", label: "network resilience" },
];

/**
 * Signature element #4 — the decision bar. Visual proof that /allocate is
 * a weighted routing decision, not a database WHERE clause. Positive
 * segments (blood) added cost; negative segments (verified green) reduced
 * it — e.g. ttlSalvage going hard negative is "we get credit for using a
 * unit that was about to expire anyway."
 */
export function AllocationScore(props: AllocationScoreProps) {
  const values = ROWS.map((r) => props[r.key]);
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));

  return (
    <div data-slot="allocation-score" className={cn("flex flex-col gap-2", props.className)}>
      {ROWS.map((row) => {
        const v = props[row.key];
        const pct = (Math.abs(v) / maxAbs) * 100;
        const positive = v >= 0;
        return (
          <div key={row.key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 font-mono text-[11px] tracking-wide text-ink-muted uppercase">
              {row.label}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  positive ? "bg-blood-600" : "bg-verified-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className={cn(
                "w-16 shrink-0 text-right font-mono text-xs tabular-nums",
                positive ? "text-blood-700" : "text-verified-500",
              )}
            >
              {positive ? "+" : ""}
              {v.toFixed(1)}
            </span>
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
        <span className="font-mono text-[11px] tracking-wide text-ink-muted uppercase">total cost</span>
        <span
          className={cn(
            "font-heading text-2xl font-bold tabular-nums",
            props.total >= 0 ? "text-blood-700" : "text-verified-500",
          )}
        >
          {props.total >= 0 ? "+" : ""}
          {props.total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { formatIST } from "@/lib/format";

export type CustodyChainEvent = {
  id: string;
  eventType: string;
  occurredAt: string | Date;
  actorLabel?: string;
  hashPrefix: string;
  /** Whether this event's own hash still matches its predecessor's chain — false severs the rail from here on. */
  verified: boolean;
};

function Connector({ broken, orientation }: { broken: boolean; orientation: "horizontal" | "vertical" }) {
  if (!broken) {
    return (
      <div
        className={cn(
          "bg-line-strong",
          orientation === "horizontal" ? "h-px w-8 shrink-0" : "ml-[15px] h-8 w-px",
        )}
      />
    );
  }
  // A genuinely severed connector — a jagged gap, not a red dot in a corner.
  return (
    <svg
      className={cn("shrink-0 text-alert-500", orientation === "horizontal" ? "h-4 w-8" : "ml-2 h-8 w-6")}
      viewBox={orientation === "horizontal" ? "0 0 32 16" : "0 0 24 32"}
      fill="none"
    >
      {orientation === "horizontal" ? (
        <path
          d="M0 8 L10 8 L13 2 L16 14 L19 4 L22 8 L32 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 3"
        />
      ) : (
        <path
          d="M12 0 L12 10 L18 13 L6 16 L18 19 L6 22 L12 25 L12 32"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 3"
        />
      )}
    </svg>
  );
}

/**
 * The custody rail — signature element #3. Horizontal for a unit's own
 * detail page, vertical for the live feed. A broken hash link renders as
 * an actually severed connector plus an alert badge, never a red dot.
 */
export function CustodyChain({
  events,
  orientation = "vertical",
  className,
}: {
  events: CustodyChainEvent[];
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      data-slot="custody-chain"
      className={cn(
        "flex",
        orientation === "horizontal" ? "flex-row items-start overflow-x-auto" : "flex-col",
        className,
      )}
    >
      {events.map((e, i) => (
        <div
          key={e.id}
          className={cn("flex", orientation === "horizontal" ? "flex-row items-center" : "flex-col")}
        >
          {i > 0 && <Connector broken={!e.verified} orientation={orientation} />}
          <div
            className={cn(
              "flex min-w-[168px] flex-col gap-0.5 rounded-lg border bg-paper px-3 py-2",
              e.verified ? "border-line" : "border-alert-500/50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink">{e.eventType.replace(/_/g, " ")}</span>
              {e.verified ? (
                <span className="text-verified-500" aria-label="verified" title="Hash verified">
                  ✓
                </span>
              ) : (
                <span
                  className="rounded-4xl bg-alert-500-a12 px-1.5 py-0.5 text-[10px] font-medium text-alert-500"
                  aria-label="chain broken"
                >
                  BROKEN
                </span>
              )}
            </div>
            {e.actorLabel && <span className="text-xs text-ink-muted">{e.actorLabel}</span>}
            <span className="font-mono text-[11px] text-ink-faint">{e.hashPrefix}</span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              {formatIST(e.occurredAt)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

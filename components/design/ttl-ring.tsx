"use client";

import { cn } from "@/lib/utils";

function formatRemaining(hours: number): string {
  if (hours <= 0) return "expired";
  const totalMinutes = Math.floor(hours * 60);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Shelf-life ring — signature element #2. A counterclockwise-draining arc
 * around the component glyph. Neutral above 48h, warn under 48h, alert
 * (and only then, pulsing) under 12h.
 */
export function TTLRing({
  remainingHours,
  totalHours,
  size = 72,
  className,
}: {
  remainingHours: number;
  totalHours: number;
  size?: number;
  className?: string;
}) {
  const ratio = Math.max(0, Math.min(1, remainingHours / totalHours));
  const stroke = size * 0.07;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  const critical = remainingHours <= 12 && remainingHours > 0;
  const warning = remainingHours <= 48 && remainingHours > 12;
  const expired = remainingHours <= 0;

  const ringColor = expired
    ? "text-alert-500"
    : critical
      ? "text-alert-500"
      : warning
        ? "text-warn-500"
        : "text-verified-500";

  const labelColor = expired || critical ? "text-alert-500" : warning ? "text-warn-500" : "text-ink";

  return (
    <div
      data-slot="ttl-ring"
      className={cn("relative inline-flex items-center justify-center", critical && "animate-pulse-833", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${formatRemaining(remainingHours)} of shelf life remaining`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-none stroke-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={cn("fill-none transition-[stroke-dashoffset] duration-500", ringColor)}
          stroke="currentColor"
        />
      </svg>
      <span className={cn("absolute font-mono text-[0.62em] font-medium tabular-nums", labelColor)}>
        {formatRemaining(remainingHours)}
      </span>
    </div>
  );
}

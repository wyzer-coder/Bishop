"use client";

import { useState } from "react";
import { toast } from "sonner";
import { parseBua } from "@/lib/domain/protocol";
import { COMPONENT_ACCENT } from "@/lib/design/component-accent";
import { cn } from "@/lib/utils";

function groupLabel(g: string) {
  return g.replace("_POS", "+").replace("_NEG", "-");
}

const SIZES = {
  sm: "text-xs gap-0.5",
  md: "text-sm gap-1",
  lg: "text-lg gap-1.5",
};

/**
 * The address chip — signature element #1. Wraps the real buaFor()/
 * parseBua() from lib/domain/protocol.ts, so this never has its own idea
 * of what a BUA looks like; it only decorates the domain's own format.
 */
export function UnitAddress({
  bua,
  size = "md",
  className,
}: {
  bua: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const parsed = parseBua(bua);

  async function handleCopy() {
    await navigator.clipboard.writeText(bua);
    setCopied(true);
    toast("address copied", { className: "font-mono text-xs" });
    setTimeout(() => setCopied(false), 1200);
  }

  if (!parsed) {
    return <span className={cn("font-mono text-ink-faint", SIZES[size], className)}>{bua}</span>;
  }

  const accent = COMPONENT_ACCENT[parsed.component];

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      data-slot="unit-address"
      className={cn(
        "group/addr inline-flex items-center rounded-md border border-transparent px-1 font-mono transition-colors hover:border-line",
        SIZES[size],
        className,
      )}
    >
      <span className="text-ink-faint">bua:</span>
      <span className="text-ink" title="Facility">
        {parsed.facilityCode}
      </span>
      <span className="text-ink-faint">/</span>
      <span className="text-blood-600" title="Blood group">
        {groupLabel(parsed.group)}
      </span>
      <span className="text-ink-faint">/</span>
      <span className={accent.text} title="Component">
        {parsed.component}
      </span>
      <span className="text-ink-faint">/</span>
      <span className="text-ink-faint group-hover/addr:text-ink-muted" title="RFID serial">
        {parsed.rfidUid}
      </span>
      {copied && <span className="ml-1.5 text-verified-500">✓</span>}
    </button>
  );
}

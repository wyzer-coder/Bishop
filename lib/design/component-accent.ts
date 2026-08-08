import type { Component } from "@/lib/domain/units";

// §4.2's component color mapping, translated onto this project's actual
// componentEnum (WHOLE / PRBC / PLATELET / PLASMA — not the FFP/PLT/CRYO
// shorthand the brief's copy uses). PRBC and PLASMA map directly; PLATELET
// takes the brief's PLT→warn slot; WHOLE takes the unused CRYO→cryo slot
// as its own distinct identity color rather than defaulting to plain ink.
export const COMPONENT_ACCENT: Record<Component, { text: string; bg: string; border: string }> = {
  PRBC: { text: "text-blood-600", bg: "bg-blood-50", border: "border-blood-200" },
  PLASMA: { text: "text-plasma-700", bg: "bg-plasma-100", border: "border-plasma-500/40" },
  PLATELET: { text: "text-warn-500", bg: "bg-plasma-100", border: "border-warn-500/40" },
  WHOLE: { text: "text-cryo-700", bg: "bg-cryo-100", border: "border-cryo-500/40" },
};

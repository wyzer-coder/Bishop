import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// A selectable pill — blood-group/component pickers, filter chips, the
// "DHANBAD · JHARKHAND PILOT" nav marker. Distinct from Badge: Badge marks
// a status on a row you don't click; Chip is interactive and mono by
// default, since it's most often labeling something the system generated
// (a group code, a facility code) rather than prose.
const chipVariants = cva(
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-4xl border px-3 font-mono text-xs font-medium whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default:
          "border-line bg-paper text-ink-muted hover:border-line-strong hover:text-ink",
        selected: "border-blood-600 bg-blood-600 text-white",
        rare: "border-blood-200 bg-blood-50 text-blood-700 hover:border-blood-400",
        rareSelected: "border-blood-600 bg-blood-600 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Chip({
  className,
  variant,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof chipVariants>) {
  return (
    <button
      data-slot="chip"
      type={type}
      className={cn(chipVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Chip, chipVariants };

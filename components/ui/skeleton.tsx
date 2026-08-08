import { cn } from "@/lib/utils";

// Skeletons match final geometry (never a centered spinner) and shimmer at
// 833ms — the same "the system is still breathing" rhythm as the live
// custody feed and the TTL ring pulse, not a generic loading placeholder
// cadence. See the `animate-shimmer` keyframe in globals.css.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-shimmer rounded-md bg-surface-2", className)}
      {...props}
    />
  );
}

export { Skeleton };

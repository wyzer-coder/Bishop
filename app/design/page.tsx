import { notFound } from "next/navigation";
import { DesignReview } from "@/components/design/design-review";

// Dev-only design-system review route (UI/UX redesign brief, Pass 1). Not
// linked from nav. Belt-and-suspenders on top of Clerk's default
// protection (middleware.ts is off-limits for this brief, so this route
// inherits the same auth-required default as every other /(app) page
// without any middleware edit) — also hard-gated out of production here.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <DesignReview />;
}

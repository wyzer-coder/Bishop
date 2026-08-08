import { FacilitiesMap } from "@/components/facilities-map";

export default function MapPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network map</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every seeded facility around Dhanbad, plotted at its real coordinates. Click a
          marker for on-hand stock and risk.
        </p>
      </div>
      <FacilitiesMap />
    </div>
  );
}

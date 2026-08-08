import { Suspense } from "react";
import { InventoryTable } from "@/components/inventory-table";

export default function InventoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <InventoryTable />
      </Suspense>
    </div>
  );
}

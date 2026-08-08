import { BillingConsole } from "@/components/billing-console";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <BillingConsole />
    </div>
  );
}

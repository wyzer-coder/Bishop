import { TransfersConsole } from "@/components/transfers-console";

export default function TransfersPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
      <TransfersConsole />
    </div>
  );
}

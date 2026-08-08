import { ColdChainConsole } from "@/components/coldchain-console";

export default function ColdChainPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Cold Chain</h1>
      <ColdChainConsole />
    </div>
  );
}

import { Simulator } from "@/components/simulator";

export default function SimulatorPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Simulator</h1>
      <Simulator />
    </div>
  );
}

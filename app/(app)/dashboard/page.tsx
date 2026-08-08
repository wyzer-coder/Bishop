import { DashboardConsole } from "@/components/dashboard-console";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <DashboardConsole />
    </div>
  );
}

import { CreditsConsole } from "@/components/credits-console";

export default function CreditsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>
      <CreditsConsole />
    </div>
  );
}

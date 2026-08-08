import { ProtocolConsole } from "@/components/protocol-console";

export default function ProtocolPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Protocol</h1>
      <ProtocolConsole />
    </div>
  );
}

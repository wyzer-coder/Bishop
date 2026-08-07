import { UnitDetail } from "@/components/unit-detail";

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Unit</h1>
      <UnitDetail unitId={id} />
    </div>
  );
}

import { FamilyCreditsConsole } from "@/components/family-credits-console";

export default function FamilyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Family credits</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A separate, personal layer from the network credit ledger. Donating earns one
          credit; a verified family member can redeem it for a same-value unit instead of
          searching for a donor. Non-monetary, non-transferable outside a verified link.
        </p>
      </div>
      <FamilyCreditsConsole />
    </div>
  );
}

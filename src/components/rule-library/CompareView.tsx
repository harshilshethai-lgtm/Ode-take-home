import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput } from "@/components/ui/form";
import { countChanges } from "@/domain/rules/diff";
import { VERSION_STATUS_LABEL, label } from "@/lib/labels";
import { rangeLabel } from "@/lib/ruleCard";
import { useRules } from "@/lib/useRules";
import { DiffView } from "./DiffView";

interface Props {
  policyId: string;
  /** Version ids, as in the URL. Shown oldest first whichever way round they were given. */
  aId: string;
  bId: string;
  onBack: () => void;
  onChange: (aId: string, bId: string) => void;
}

/** Any two versions of a policy, side by side in words. */
export function CompareView({ policyId, aId, bId, onBack, onChange }: Props) {
  const rules = useRules();
  const found = rules.listPolicies().find((s) => s.policy.id === policyId);
  const versions = found ? rules.getPolicy(policyId).versions : [];
  const a = versions.find((v) => v.id === aId);
  const b = versions.find((v) => v.id === bId);

  const back = (
    <Button variant="ghost" onClick={onBack} className="-ml-2 mb-2">
      <ArrowLeft size={14} /> {found ? `${found.payer.name} · ${found.policy.externalPolicyId}` : "Rule library"}
    </Button>
  );
  if (!found || !a || !b) {
    return (
      <>
        {back}
        <EmptyState>Those versions were not found</EmptyState>
      </>
    );
  }

  const [from, to] = a.versionNumber <= b.versionNumber ? [a, b] : [b, a];
  const diff = rules.compareVersions(from.id, to.id);
  const count = countChanges(diff);

  const picker = (name: string, value: string, set: (id: string) => void) => (
    <label className="flex items-center gap-2 text-body text-fg-2">
      {name}
      <SelectInput aria-label={name} value={value} onChange={(e) => set(e.target.value)} className="w-auto">
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{v.versionNumber} · {label(VERSION_STATUS_LABEL, v.derivedStatus)}
          </option>
        ))}
      </SelectInput>
    </label>
  );

  return (
    <>
      {back}
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <span className="text-emph text-fg">Compare</span>
          {picker("From", from.id, (id) => onChange(id, to.id))}
          {picker("To", to.id, (id) => onChange(from.id, id))}
          <span className="tabular ml-auto text-body text-fg-2">
            {count === 0 ? "No changes" : `${count} ${count === 1 ? "change" : "changes"}`}
          </span>
        </div>
        <div className="px-4 py-2 text-caption text-fg-2">
          v{from.versionNumber} {rangeLabel(from)} → v{to.versionNumber} {rangeLabel(to)}
        </div>
        <DiffView diff={diff} />
      </Card>
    </>
  );
}

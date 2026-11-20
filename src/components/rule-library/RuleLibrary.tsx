import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusLabel } from "@/components/ui/status-dot";
import { buildRuleCard, fmtShortDate, versionBadge } from "@/lib/ruleCard";
import { useRules } from "@/lib/useRules";
import { CompareView } from "./CompareView";
import { NewPolicyDialog } from "./NewPolicyDialog";
import { PolicyCard } from "./PolicyCard";
import { AssumptionCount } from "./parts";
import { RecentChanges } from "./RecentChanges";

/**
 * Which policy, which of its versions, and whether it is being edited. All three live in the URL, so a view can
 * be linked and the back button does what you expect. Edit mode only ever comes from the Edit button.
 */
function useSelection() {
  const [params, setParams] = useSearchParams();
  const set = (patch: { policy?: string | null; version?: string | null; edit?: boolean; compare?: [string, string] | null }) =>
    setParams((p) => {
      const q = new URLSearchParams(p);
      for (const [k, v] of [["policy", patch.policy], ["v", patch.version]] as const) {
        if (v === undefined) continue;
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (patch.compare !== undefined) {
        if (patch.compare) q.set("compare", patch.compare.join(","));
        else q.delete("compare");
      }
      if (patch.edit !== undefined) {
        if (patch.edit) q.set("edit", "1");
        else q.delete("edit");
      }
      return q;
    });
  const pair = params.get("compare")?.split(",");
  return {
    policyId: params.get("policy"),
    versionId: params.get("v"),
    editing: params.get("edit") === "1",
    compare: pair && pair.length === 2 ? ([pair[0], pair[1]] as [string, string]) : null,
    openPolicy: (id: string | null) => set({ policy: id, version: null, edit: false, compare: null }),
    openVersion: (id: string | null, edit = false) => set({ version: id, edit, compare: null }),
    openDraft: (policyId: string, draftId: string) => set({ policy: policyId, version: draftId, edit: true, compare: null }),
    openPolicyVersion: (policyId: string, versionId: string) => set({ policy: policyId, version: versionId, edit: false, compare: null }),
    openCompare: (policyId: string, a: string, b: string) => set({ policy: policyId, version: null, edit: false, compare: [a, b] }),
    closeCompare: () => set({ compare: null }),
  };
}

export function RuleLibrary() {
  const sel = useSelection();
  if (sel.policyId && sel.compare) {
    return (
      <CompareView
        policyId={sel.policyId}
        aId={sel.compare[0]}
        bId={sel.compare[1]}
        onBack={sel.closeCompare}
        onChange={(a, b) => sel.openCompare(sel.policyId!, a, b)}
      />
    );
  }
  return sel.policyId ? (
    <PolicyCard
      policyId={sel.policyId}
      versionId={sel.versionId}
      editing={sel.editing}
      onBack={() => sel.openPolicy(null)}
      onVersion={sel.openVersion}
      onCompare={(a, b) => sel.openCompare(sel.policyId!, a, b)}
    />
  ) : (
    <PolicyList
      onOpen={sel.openPolicy}
      onCreated={(policy, draftId) => sel.openDraft(policy.id, draftId)}
      onCompare={sel.openCompare}
      onOpenVersion={sel.openPolicyVersion}
    />
  );
}

/** One row per policy: payer · policy ID · title · version · assumptions. */
function PolicyList({
  onOpen,
  onCreated,
  onCompare,
  onOpenVersion,
}: {
  onOpen: (id: string) => void;
  onCreated: (policy: { id: string }, draftId: string) => void;
  onCompare: (policyId: string, a: string, b: string) => void;
  onOpenVersion: (policyId: string, versionId: string) => void;
}) {
  const rules = useRules();
  const [creating, setCreating] = useState(false);
  const summaries = rules.listPolicies();
  const today = rules.today();
  return (
    <>
      <RecentChanges
        items={rules.listRecentPublishes(10)}
        onOpen={(r) => (r.previousVersionId ? onCompare(r.policyId, r.previousVersionId, r.versionId) : onOpenVersion(r.policyId, r.versionId))}
      />
      <div className="mb-2 flex justify-end">
        <Button variant="default" onClick={() => setCreating(true)}>
          <Plus size={14} /> New policy
        </Button>
      </div>
      {summaries.length === 0 ? (
        <EmptyState>No policies yet</EmptyState>
      ) : (
        <Card>
          {summaries.map((s) => {
            const shown = s.current ?? s.openDraft;
            const count = shown ? buildRuleCard(shown).assumptionCount : 0;
            return (
              <button
                key={s.policy.id}
                type="button"
                onClick={() => onOpen(s.policy.id)}
                className="group flex h-9 w-full items-center gap-2 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-hover"
              >
                <ChevronRight size={14} className="shrink-0 text-fg-3" />
                <span className="shrink-0 whitespace-nowrap text-emph text-fg">
                  {s.payer.name} · <span className="tabular">{s.policy.externalPolicyId}</span>
                </span>
                <span className="min-w-0 truncate text-fg-2">{s.policy.title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-4 pl-2">
                  <AssumptionCount count={count} />
                  {s.openDraft && <StatusLabel tone="hold">Draft</StatusLabel>}
                  {s.scheduled && s.scheduled.effectiveFrom && (
                    <span className="whitespace-nowrap text-caption text-fg-2">
                      v{s.scheduled.versionNumber} scheduled · {fmtShortDate(s.scheduled.effectiveFrom, today)}
                    </span>
                  )}
                  <StatusLabel tone={shown?.derivedStatus === "active" ? "ready" : "neutral"}>{versionBadge(shown)}</StatusLabel>
                </span>
              </button>
            );
          })}
        </Card>
      )}
      {creating && <NewPolicyDialog open onOpenChange={setCreating} onCreated={onCreated} />}
    </>
  );
}

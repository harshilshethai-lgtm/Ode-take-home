import { ChevronRight, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusLabel } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import { isClosed } from "@/domain/statuses";
import { VERSION_STATUS_LABEL, label } from "@/lib/labels";
import { buildRuleCard, fmtShortDate, policyVersionLabel } from "@/lib/ruleCard";
import { useRules } from "@/lib/useRules";
import { useOrders } from "@/lib/useWorklistState";
import { CompareView } from "./CompareView";
import { PolicyCard } from "./PolicyCard";
import { AssumptionCount, versionTone } from "./parts";
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
      onCompare={sel.openCompare}
      onOpenVersion={sel.openPolicyVersion}
    />
  );
}

/** One row per policy: payer · policy ID · title · version · assumptions. */
function PolicyList({
  onOpen,
  onCompare,
  onOpenVersion,
}: {
  onOpen: (id: string) => void;
  onCompare: (policyId: string, a: string, b: string) => void;
  onOpenVersion: (policyId: string, versionId: string) => void;
}) {
  const rules = useRules();
  const summaries = rules.listPolicies();
  const today = rules.today();
  return (
    <>
      <div className="mb-2 flex justify-end">
        <Tip content="Read-only in prototype">
          <span className="inline-flex">
            <Button variant="default" disabled>
              <Plus size={14} /> New policy
            </Button>
          </span>
        </Tip>
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
                className="group flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left text-body last:border-b-0 hover:bg-hover"
              >
                <ChevronRight size={14} className="mt-1 shrink-0 text-fg-3" />
                <span className="min-w-0 flex-1">
                  <span className="text-emph text-fg">
                    {s.payer.name} · <span className="tabular">{s.policy.externalPolicyId}</span>
                  </span>
                  <span className="text-fg-2"> {s.policy.title}</span>
                  {shown && (
                    <span className="mt-1 block text-caption tabular text-fg-2">
                      {policyVersionLabel(s.policy.externalPolicyId, shown.sourceRevisionLabel, shown.versionNumber)}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-4 pl-2">
                  <AssumptionCount count={count} />
                  {s.openDraft && <StatusLabel tone="hold">Draft</StatusLabel>}
                  {s.scheduled && s.scheduled.effectiveFrom && (
                    <span className="whitespace-nowrap text-caption text-fg-2">
                      v{s.scheduled.versionNumber} scheduled · {fmtShortDate(s.scheduled.effectiveFrom, today)}
                    </span>
                  )}
                  {shown && (
                    <StatusLabel tone={versionTone(shown.derivedStatus)}>{label(VERSION_STATUS_LABEL, shown.derivedStatus)}</StatusLabel>
                  )}
                </span>
              </button>
            );
          })}
        </Card>
      )}
      <RuleGaps />
      <RecentChanges
        items={rules.listRecentPublishes(10)}
        onOpen={(r) => (r.previousVersionId ? onCompare(r.policyId, r.previousVersionId, r.versionId) : onOpenVersion(r.policyId, r.versionId))}
      />
    </>
  );
}

/** Open cases the engine parked because no policy covers the study. */
function RuleGaps() {
  const { orders } = useOrders();
  const gaps = orders.filter((order) => order.reasonCode === "RULE_GAP" && !isClosed(order.status));
  if (gaps.length === 0) return null;
  return (
    <Card className="mt-4">
      {gaps.map((order) => {
        const insurer = textOf(order.detail.insurer) || order.insurer || "Unknown insurer";
        const cpt = textOf(order.detail.cpt) || order.cpt || "this study";
        return (
          <div key={order.id} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <Link to={`/case/${order.id}`} className="text-body text-accent-fg">
              Rule gap · {insurer}, no rules for {cpt}
            </Link>
            <Tip content="Read-only in prototype">
              <span className="ml-auto inline-flex">
                <Button variant="secondary" disabled>
                  Create draft policy from insurer document
                </Button>
              </span>
            </Tip>
          </div>
        );
      })}
    </Card>
  );
}

function textOf(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

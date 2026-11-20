import { ArrowLeft, GitCompare, History, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, ExpandRow } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { StatusLabel } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import { ApiError, type VersionView } from "@/data/rules/service";
import { VERSION_STATUS_LABEL, label } from "@/lib/labels";
import { countChanges } from "@/domain/rules/diff";
import { buildRuleCard, rangeLabel, scheduledBanner, versionBanner } from "@/lib/ruleCard";
import { useRulesActor } from "@/lib/rulesActor";
import { useRules } from "@/lib/useRules";
import { DraftCard } from "./DraftCard";
import { Assumption, AssumptionCount, AssumptionDot, PropertyRows, SourceToggle, VersionItem, firstName, versionTone } from "./parts";

interface Props {
  policyId: string;
  versionId: string | null;
  editing: boolean;
  onBack: () => void;
  /** Open a version (null = the current one), optionally in edit mode. */
  onVersion: (id: string | null, edit?: boolean) => void;
  onCompare: (aId: string, bId: string) => void;
}

export function PolicyCard({ policyId, versionId, editing, onBack, onVersion, onCompare }: Props) {
  const rules = useRules();
  const actor = useRulesActor();
  const [panelOpen, setPanelOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Set while the Versions panel is waiting for the second version to compare with. */
  const [compareBase, setCompareBase] = useState<VersionView | null>(null);
  const found = rules.listPolicies().find((s) => s.policy.id === policyId);
  const versions = found ? rules.getPolicy(policyId).versions : [];
  const governing = found ? (found.current ?? found.openDraft) : null;
  const v = (versionId ? versions.find((x) => x.id === versionId) : null) ?? governing;

  const back = (
    <Button variant="ghost" onClick={onBack} className="-ml-2 mb-2">
      <ArrowLeft size={14} /> Rule library
    </Button>
  );
  if (!found || !v) {
    return (
      <>
        {back}
        <EmptyState>Policy not found</EmptyState>
      </>
    );
  }

  if (editing && v.derivedStatus === "draft") {
    return (
      <>
        {back}
        <DraftCard
          key={v.id}
          policy={found.policy}
          payer={found.payer}
          version={v}
          onDone={() => onVersion(v.id, false)}
          onPublished={(published) => onVersion(published.id, false)}
          onDiscarded={(policyRemoved) => (policyRemoved ? onBack() : onVersion(null, false))}
        />
      </>
    );
  }

  const draft = found.openDraft;
  const active = versions.find((x) => x.derivedStatus === "active") ?? null;
  const banner = versionBanner(v, versions);
  const card = buildRuleCard(v);
  const cptList = v.applicability.cptCodes.join(", ");
  // Editing starts from the version that governs today. Old versions are history.
  const canEdit = v.id === governing?.id || v.derivedStatus === "draft";

  const closePanel = (open: boolean) => {
    setPanelOpen(open);
    if (!open) setCompareBase(null);
  };

  // Restoring never edits history: the old version is cloned into a new draft, which is then edited like any other.
  const restore = (x: VersionView) => {
    setProblem(null);
    try {
      const d = rules.createDraft(policyId, { actor, cloneFrom: x.id, kind: "rollback" });
      closePanel(false);
      onVersion(d.id, true);
    } catch (e) {
      closePanel(false);
      setProblem(e instanceof ApiError ? e.message : "Could not restore that version.");
    }
  };

  const scheduled = found.scheduled;
  const scheduledNote =
    !banner && v.derivedStatus === "active" && scheduled
      ? scheduledBanner(scheduled, countChanges(rules.compareVersions(v.id, scheduled.id)), rules.today())
      : null;

  const startEditing = () => {
    setProblem(null);
    if (draft) return onVersion(draft.id, true);
    try {
      onVersion(rules.createDraft(policyId, { actor, cloneFrom: v.id }).id, true);
    } catch (e) {
      // Someone else started a draft a moment ago: join it rather than fail.
      const existing = rules.listPolicies().find((s) => s.policy.id === policyId)?.openDraft;
      if (e instanceof ApiError && e.status === 409 && existing) return onVersion(existing.id, true);
      setProblem(e instanceof ApiError ? e.message : "Could not start a draft.");
    }
  };

  return (
    <>
      {back}
      {scheduledNote && scheduled && (
        <div role="status" className="mb-2 flex min-h-9 items-center gap-2 rounded-lg border border-line bg-chip px-3 text-body text-fg">
          <span>{scheduledNote}</span>
          <Button variant="link" onClick={() => onCompare(v.id, scheduled.id)} className="ml-auto shrink-0">
            View changes →
          </Button>
        </div>
      )}
      {banner && (
        <div role="status" className="mb-2 flex min-h-9 items-center gap-2 rounded-lg border border-line bg-chip px-3 text-body text-fg">
          <span>{banner}</span>
          {active && active.id !== v.id && (
            <Button variant="link" onClick={() => onVersion(null)} className="ml-auto shrink-0">
              View active version →
            </Button>
          )}
        </div>
      )}
      <Card>
        <div className="border-b border-line px-4 py-3">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="whitespace-nowrap text-emph text-fg">
              {found.payer.name} · {found.policy.externalPolicyId}
            </span>
            <span className="tabular text-body text-fg-2">v{v.versionNumber}</span>
            <span className="ml-auto flex items-center gap-4">
              <AssumptionCount count={card.assumptionCount} />
              <StatusLabel tone={versionTone(v.derivedStatus)}>{label(VERSION_STATUS_LABEL, v.derivedStatus)}</StatusLabel>
              <Button onClick={() => setPanelOpen(true)}>
                <History size={14} /> Versions <span className="tabular font-normal text-fg-2">{versions.length}</span>
              </Button>
              {canEdit && (
                <Button variant="default" onClick={startEditing}>
                  <Pencil size={14} /> {draft ? `Continue draft (by ${firstName(draft.lastEditedBy)})` : "Edit rules"}
                </Button>
              )}
            </span>
          </div>
          <div className="text-caption text-fg-2">
            {found.policy.title} ·{" "}
            <Tip content={`CPT ${cptList}`}>
              <span className="tabular">{v.applicability.cptCodes.length} CPT codes</span>
            </Tip>
            {v.effectiveFrom && <> · Effective {rangeLabel(v)}</>}
          </div>
          {problem && <div className="mt-1 text-caption text-red-500">{problem}</div>}
        </div>

        <PolicyBody card={card} />
      </Card>

      <Sheet open={panelOpen} onOpenChange={closePanel} title="Versions" count={versions.length}>
        {compareBase && (
          <div className="flex min-h-9 items-center gap-2 border-b border-line bg-chip px-4 text-body text-fg">
            <span>Compare v{compareBase.versionNumber} with…</span>
            <Button variant="link" onClick={() => setCompareBase(null)} className="ml-auto">
              Cancel
            </Button>
          </div>
        )}
        <ul>
          {versions.map((x) => {
            const restorable = x.derivedStatus === "superseded" || x.derivedStatus === "archived";
            return (
              <li key={x.id} className="border-b border-line last:border-b-0">
                <VersionItem
                  version={x}
                  selected={compareBase ? x.id === compareBase.id : x.id === v.id}
                  onSelect={() => {
                    if (compareBase) {
                      if (x.id === compareBase.id) return;
                      closePanel(false);
                      return onCompare(compareBase.id, x.id);
                    }
                    onVersion(x.id === governing?.id ? null : x.id);
                    closePanel(false);
                  }}
                  actions={
                    compareBase ? undefined : (
                      <>
                        <Button variant="ghost" onClick={() => setCompareBase(x)}>
                          <GitCompare size={14} /> Compare
                        </Button>
                        {restorable && (
                          <Tip content={draft ? "Finish or discard the open draft first" : undefined}>
                            <span>
                              <Button variant="ghost" disabled={!!draft} onClick={() => restore(x)}>
                                <RotateCcw size={14} /> Restore as new draft
                              </Button>
                            </span>
                          </Tip>
                        )}
                      </>
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

/** The same layout for every insurer: policy properties, then criteria, then exceptions. */
export function PolicyBody({ card }: { card: ReturnType<typeof buildRuleCard> }) {
  return (
    <div>
      {card.policyProperties.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <PropertyRows rows={card.policyProperties} />
        </div>
      )}
      {card.criteria.length === 0 && <div className="border-b border-line px-4 py-3 text-body text-fg-2">No criteria yet.</div>}
      {card.criteria.map((c) => (
        <ExpandRow
          key={c.key}
          summary={
            <>
              <span className="tabular min-w-6 shrink-0 text-fg-2">{c.ref}</span>
              <span className="truncate text-fg">{c.label}</span>
              {c.hasAssumption && <AssumptionDot />}
            </>
          }
          trailing={<Chip>{c.failure}</Chip>}
        >
          {c.properties.length === 0 && <div className="text-body text-fg-2">No properties yet.</div>}
          <PropertyRows rows={c.properties} />
          <SourceToggle reference={c.ref} excerpt={c.excerpt} />
        </ExpandRow>
      ))}

      {card.exceptions.map((e) => (
        <ExpandRow
          key={e.key}
          summary={
            <>
              <span className="tabular min-w-6 shrink-0 text-fg-2">{e.ref}</span>
              <span className="truncate text-fg">{e.label}</span>
              {e.assumption && <AssumptionDot />}
            </>
          }
          trailing={<span className="text-caption text-fg-2">{e.waives}</span>}
        >
          {e.assumption && <Assumption note={e.assumption} />}
          <PropertyRows rows={e.properties} />
          <SourceToggle reference={e.ref} excerpt={e.excerpt} />
        </ExpandRow>
      ))}
    </div>
  );
}

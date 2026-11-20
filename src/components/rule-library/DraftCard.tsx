import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Tip } from "@/components/ui/tooltip";
import type { VersionView } from "@/data/rules/service";
import type { Payer, Policy } from "@/domain/rules/types";
import { cn } from "@/lib/cn";
import { issueSummary } from "@/lib/ruleForm";
import { useRulesActor } from "@/lib/rulesActor";
import { ago, useDraftForm, useTicker } from "@/lib/useDraftForm";
import { useRules } from "@/lib/useRules";
import { countChanges } from "@/domain/rules/diff";
import { DiffView } from "./DiffView";
import { PublishDialog } from "./PublishDialog";
import { RuleEditor } from "./RuleEditor";

interface Props {
  policy: Policy;
  payer: Payer;
  version: VersionView;
  /** Leave edit mode; the draft stays and shows read-only. */
  onDone: () => void;
  onPublished: (v: VersionView) => void;
  onDiscarded: (policyRemoved: boolean) => void;
}

const CONFIRM_MS = 4000;

/** Edit mode: the same card, but every rule is a form. Saves itself; publishing is blocked while there are errors. */
export function DraftCard({ policy, payer, version, onDone, onPublished, onDiscarded }: Props) {
  const rules = useRules();
  const actor = useRulesActor();
  const { form, update, flush, cancel, saveState, validation } = useDraftForm(version, rules, actor);
  const now = useTicker();
  const [publishing, setPublishing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const hasBaseline = rules.getPolicy(policy.id).versions.some((v) => v.status === "published");

  useEffect(() => {
    if (!confirmDiscard) return;
    const t = setTimeout(() => setConfirmDiscard(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmDiscard]);

  const inheritedKeys = useMemo(
    () => new Set(version.clonedFromVersionId ? rules.getVersionById(version.clonedFromVersionId).version.criteria.map((c) => c.key) : []),
    [rules, version.clonedFromVersionId],
  );

  const errors = validation.errors.length;
  const summary = issueSummary(errors, validation.warnings.length);
  const status =
    saveState.kind === "error" ? saveState.message : saveState.kind === "saving" ? "saving…" : `saved ${ago(saveState.at, now)}`;

  const discard = () => {
    if (!confirmDiscard) return setConfirmDiscard(true);
    cancel();
    onDiscarded(rules.discardDraft(version.id, actor).policyRemoved);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="px-4 py-3">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="whitespace-nowrap text-emph text-fg">
              {payer.name} · {policy.externalPolicyId}
            </span>
            <span className={cn("tabular text-body", saveState.kind === "error" ? "text-red-500" : "text-fg-2")}>
              Draft v{version.versionNumber} · {status}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {summary && <span className={cn("text-caption", errors ? "text-red-500" : "text-fg-2")}>{summary}</span>}
              <Tip content={hasBaseline ? undefined : "This is the first version, so there is nothing to compare"}>
                <span>
                  <Button
                    disabled={!hasBaseline}
                    onClick={() => {
                      flush();
                      setReviewing(true);
                    }}
                  >
                    Review changes
                  </Button>
                </span>
              </Tip>
              <Button variant="ghost" onClick={discard} className={cn(confirmDiscard && "text-red-500")}>
                {confirmDiscard ? "Confirm discard" : "Discard draft"}
              </Button>
              <Button
                onClick={() => {
                  flush();
                  onDone();
                }}
              >
                Done
              </Button>
              <Tip content={errors ? "Fix the errors first" : undefined}>
                <span>
                  <Button
                    variant="default"
                    disabled={errors > 0}
                    onClick={() => {
                      flush();
                      setPublishing(true);
                    }}
                  >
                    Publish…
                  </Button>
                </span>
              </Tip>
            </span>
          </div>
          <div className="text-caption text-fg-2">{policy.title}</div>
        </div>
      </Card>

      <RuleEditor versionId={version.id} form={form} update={update} validation={validation} inheritedKeys={inheritedKeys} />

      {reviewing && <ReviewSheet versionId={version.id} onClose={() => setReviewing(false)} />}
      {publishing && <PublishDialog open onOpenChange={setPublishing} version={rules.getVersionById(version.id).version} actor={actor} onPublished={onPublished} />}
    </div>
  );
}

/** What this draft changes compared with the version that governs today. */
function ReviewSheet({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const rules = useRules();
  const preview = rules.previewPublish(versionId, { effectiveFrom: null, changeNote: null });
  const count = preview.diff ? countChanges(preview.diff) : 0;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title="Review changes" count={count} className="max-w-xl">
      {preview.diff && preview.baseline ? (
        <>
          <div className="border-b border-line px-4 py-2 text-caption text-fg-2">Compared with v{preview.baseline.versionNumber}</div>
          <DiffView diff={preview.diff} />
        </>
      ) : (
        <EmptyState>Nothing to compare yet</EmptyState>
      )}
    </Sheet>
  );
}

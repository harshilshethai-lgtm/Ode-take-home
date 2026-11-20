import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, TextArea, TextInput } from "@/components/ui/form";
import { ApiError, type VersionView } from "@/data/rules/service";
import { addDays } from "@/domain/rules/dates";
import { countChanges } from "@/domain/rules/diff";
import { fmtShortDate } from "@/lib/ruleCard";
import type { RulesUser } from "@/domain/rules/types";
import { useRules } from "@/lib/useRules";

const MAX_LINES = 5;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: VersionView;
  actor: RulesUser;
  onPublished: (v: VersionView) => void;
}

/** Publishing freezes the version. This is the one place that asks for an effective date and a change note. */
export function PublishDialog({ open, onOpenChange, version, actor, onPublished }: Props) {
  const rules = useRules();
  const today = rules.today();

  const initialDate = useMemo(() => {
    if (version.effectiveFrom) return version.effectiveFrom;
    const latest = rules
      .getPolicy(version.policyId)
      .versions.filter((v) => v.status === "published" && v.effectiveFrom)
      .map((v) => v.effectiveFrom!)
      .sort()
      .at(-1);
    return latest && latest >= today ? addDays(latest, 1) : today;
  }, [rules, version, today]);

  const [effectiveFrom, setEffectiveFrom] = useState(initialDate);
  const [changeNote, setChangeNote] = useState(version.changeNote ?? "");
  const [failure, setFailure] = useState<string | null>(null);

  const preview = useMemo(() => (open ? rules.previewPublish(version.id, { effectiveFrom, changeNote }) : null), [rules, open, version.id, effectiveFrom, changeNote]);
  const errors = preview?.validation.errors ?? [];
  const lines = preview?.summary?.lines ?? [];
  // The note is asked for here, so don't scold before it is typed.
  const blocking = errors.filter((e) => e.code !== "publish.changeNote.missing");
  const dateError = errors.find((e) => e.path === "effectiveFrom")?.message ?? null;
  const canPublish = errors.length === 0;
  const baseline = preview?.baseline ?? null;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom);
  const timing = !dateOk
    ? null
    : effectiveFrom > today
      ? `Scheduled: v${version.versionNumber} takes effect ${fmtShortDate(effectiveFrom, today)}.${baseline ? ` v${baseline.versionNumber} stays active until ${fmtShortDate(addDays(effectiveFrom, -1), today)}.` : ""}`
      : `v${version.versionNumber} takes effect ${effectiveFrom === today ? "today" : fmtShortDate(effectiveFrom, today)}.${baseline ? ` v${baseline.versionNumber} is superseded.` : ""}`;
  const changeCount = preview?.diff ? countChanges(preview.diff) : 0;

  const publish = () => {
    try {
      onPublished(rules.publishVersion(version.id, { effectiveFrom, changeNote }, actor));
      onOpenChange(false);
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : "Could not publish.");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Publish v${version.versionNumber}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" disabled={!canPublish} onClick={publish}>
            Publish
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Effective from" error={dateError}>
          {(id) => <TextInput id={id} type="date" value={effectiveFrom} invalid={!!dateError} className="w-40" onChange={(e) => setEffectiveFrom(e.target.value)} />}
        </Field>
        {timing && <span className="-mt-2 text-body text-fg-2">{timing}</span>}
        <Field label="Change note">
          {(id) => <TextArea id={id} rows={2} value={changeNote} placeholder="What changed, and why" onChange={(e) => setChangeNote(e.target.value)} />}
        </Field>

        {lines.length > 0 && (
          <div className="flex flex-col gap-1 text-body">
            <span className="text-caption text-fg-2">
              What changes <span className="tabular">{changeCount}</span>
            </span>
            {lines.slice(0, MAX_LINES).map((l) => (
              <span key={l} className="text-fg">
                {l}
              </span>
            ))}
            {lines.length > MAX_LINES && <span className="text-fg-2">and {lines.length - MAX_LINES} more</span>}
          </div>
        )}

        {preview && preview.openAssumptions > 0 && (
          <div className="flex items-center gap-2 text-body text-fg-2">
            <TriangleAlert size={14} className="text-amber-500" />
            <span>
              <span className="tabular">{preview.openAssumptions}</span> {preview.openAssumptions === 1 ? "assumption" : "assumptions"} to confirm with the payer
            </span>
          </div>
        )}

        {preview && preview.tests.total > 0 && (
          <div className="text-body text-fg-2">
            <span className="tabular">
              {preview.tests.candidatePassing} of {preview.tests.total}
            </span>{" "}
            test cases pass
            {preview.tests.changedCount > 0 && (
              <>
                , <span className="tabular">{preview.tests.changedCount}</span> change result
              </>
            )}
          </div>
        )}

        {blocking.filter((e) => e.path !== "effectiveFrom").map((e) => (
          <span key={e.path + e.message} className="text-caption text-red-500">
            {e.message}
          </span>
        ))}
        {failure && <span className="text-caption text-red-500">{failure}</span>}
      </div>
    </Modal>
  );
}

import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { TestResults } from "@/components/rules/TestResults";
import { Banner, Button, Modal, Pill, SectionTitle } from "@/components/rules/ui";
import { inputCls } from "@/components/rules/fields";
import { ApiError, type VersionView } from "@/data/rules/service";
import { useRulesUser } from "@/lib/rulesUser";
import { useRules } from "@/lib/useRules";

/** Effective date, change note, diff summary, test results and open assumptions: everything needed to publish with confidence. */
export default function PublishModal({ version, onClose, onPublished }: { version: VersionView; onClose: () => void; onPublished: (v: VersionView) => void }) {
  const api = useRules();
  const { user } = useRulesUser();
  const today = api.today();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [changeNote, setChangeNote] = useState(version.changeNote ?? "");
  const [ack, setAck] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => api.previewPublish(version.id, { effectiveFrom: effectiveFrom || null, changeNote }),
    // previewPublish reads the store; re-run when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version.id, effectiveFrom, changeNote],
  );
  const { validation, summary, tests, openAssumptions, baseline } = preview;
  const failing = tests.candidateFailing;
  const blockedByRole = preview.twoPersonRule && (user.role !== "approver" || user.name === version.lastEditedBy);
  const needsAck = failing > 0 || openAssumptions > 0;
  const canPublish = validation.errors.length === 0 && !blockedByRole && (!needsAck || ack);
  const future = !!effectiveFrom && effectiveFrom > today;

  const publish = () => {
    try {
      onPublished(api.publishVersion(version.id, { effectiveFrom, changeNote }, user));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not publish.");
    }
  };

  return (
    <Modal
      wide
      title={`Publish v${version.versionNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canPublish} onClick={publish}>
            {future ? "Schedule publish" : "Publish now"}
          </Button>
        </>
      }
    >
      {error && <Banner tone="rose">{error}</Banner>}

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Effective from</span>
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputCls} />
          <span className="mt-1 block text-xs text-slate-500">
            {future ? (
              <span className="inline-flex items-center gap-1 text-sky-700"><CalendarClock size={12} /> Future date: this will be scheduled. Until then, v{baseline?.versionNumber} stays in force.</span>
            ) : (
              "Takes effect immediately. Evaluations already run keep the version they used."
            )}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Change note (required)</span>
          <textarea
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            rows={3}
            placeholder="What changed and why, e.g. “Insurer Rev. 4 raises minimum symptom duration to 6 weeks.”"
            className={inputCls}
          />
        </label>
      </div>

      {validation.errors.length > 0 && (
        <Banner tone="rose">
          <div className="mb-1 font-medium">Fix before publishing</div>
          <ul className="list-disc space-y-0.5 pl-4">{validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Banner>
      )}
      {validation.warnings.filter((w) => w.code === "publish.effective.past").map((w, i) => <Banner key={i} tone="amber">{w.message}</Banner>)}
      {blockedByRole && (
        <Banner tone="amber">
          The two-person rule is on. Publishing needs an approver who is not the last editor ({version.lastEditedBy}). You are {user.name} ({user.role}).
        </Banner>
      )}

      <section>
        <SectionTitle>What changes{baseline ? ` (v${baseline.versionNumber} → v${version.versionNumber})` : ""}</SectionTitle>
        {summary && summary.lines.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-800">{summary.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        ) : (
          <p className="text-sm text-slate-500">{baseline ? `No differences from v${baseline.versionNumber}.` : "This is the first published version."}</p>
        )}
      </section>

      <section>
        <SectionTitle
          aside={
            <button type="button" onClick={() => setShowTests((s) => !s)} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
              {showTests ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showTests ? "Hide" : "Show"} test table
            </button>
          }
        >
          Test results
        </SectionTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={failing === 0 ? "emerald" : "rose"}>{tests.candidatePassing} of {tests.total} pass</Pill>
          {tests.changedCount > 0 && <Pill tone="amber">{tests.changedCount} outcome{tests.changedCount === 1 ? "" : "s"} differ from the active version</Pill>}
          {tests.total < 3 && <Pill tone="amber">Fewer than 3 test cases</Pill>}
        </div>
        {showTests && <div className="mt-2"><TestResults result={tests} candidateLabel={`v${version.versionNumber}`} /></div>}
      </section>

      <section>
        <SectionTitle>Open assumptions</SectionTitle>
        <p className="text-sm text-slate-800">
          {openAssumptions === 0 ? "None." : `${openAssumptions} criteri${openAssumptions === 1 ? "on or exception is" : "a or exceptions are"} marked as an assumption. Confirm with the payer when you can.`}
        </p>
      </section>

      {needsAck && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300" />
          <span>
            I have reviewed this{failing > 0 ? `, including ${failing} failing test${failing === 1 ? "" : "s"}` : ""}
            {openAssumptions > 0 ? `${failing > 0 ? " and" : ","} ${openAssumptions} open assumption${openAssumptions === 1 ? "" : "s"}` : ""}, and want to publish anyway.
          </span>
        </label>
      )}
    </Modal>
  );
}

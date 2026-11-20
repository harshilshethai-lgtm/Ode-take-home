import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { describeApplicability, describeCriterion, describeSubmission, describeTrigger } from "@/domain/rules/describe";
import type { Applicability, Criterion, PolicyException, Submission } from "@/domain/rules/types";
import { AssumptionBadge, Pill } from "./ui";

export interface RuleViewData {
  applicability: Applicability;
  logic: "ALL";
  criteria: Criterion[];
  exceptions: PolicyException[];
  submission: Submission;
}

/** The rule as the insurer would read it. Used for published versions, drafts (live preview) and diffs. */
export function RuleView({ data, compact = false }: { data: RuleViewData; compact?: boolean }) {
  const criteria = [...data.criteria].sort((a, b) => a.sortOrder - b.sortOrder);
  const labelFor = (key: string) => criteria.find((c) => c.key === key)?.displayLabel ?? key;

  return (
    <div className="space-y-5 text-sm">
      <p className="text-slate-700">
        <span className="font-medium text-slate-900">Applies to:</span> {describeApplicability(data.applicability)}
      </p>

      <section>
        <p className="mb-2 text-slate-700">
          Approve when <strong className="text-slate-900">{data.logic}</strong> of the following are documented:
        </p>
        <ol className="space-y-2">
          {criteria.map((c, i) => (
            <CriterionItem key={c.id} index={i + 1} c={c} compact={compact} />
          ))}
          {criteria.length === 0 && <li className="text-slate-500">No criteria yet.</li>}
        </ol>
      </section>

      {data.exceptions.length > 0 && (
        <section>
          <h4 className="mb-2 font-medium text-slate-900">Exceptions</h4>
          <ul className="space-y-2">
            {data.exceptions.map((e) => (
              <li key={e.id} id={`exception-${e.key}`} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{e.displayLabel || e.key}</span>
                  {e.evaluationMode === "human_review" && <Pill tone="violet" title="Triggers need clinical judgment, so a clinician confirms.">Clinician confirms</Pill>}
                  {e.isAssumption && <AssumptionBadge />}
                </div>
                <p className="mt-1.5 text-slate-700">
                  If any of{" "}
                  {e.triggers.length === 0 ? (
                    <em className="text-slate-500">(no triggers)</em>
                  ) : (
                    e.triggers.map((t) => (
                      <span key={t} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                        {describeTrigger(t)}
                      </span>
                    ))
                  )}
                  , the following criteria are waived:{" "}
                  <strong className="text-slate-900">{e.waivesCriterionKeys.map(labelFor).join(", ") || "(none)"}</strong>.
                </p>
                <Citation section={e.sourceCitation.section} excerpt={e.sourceCitation.excerpt} />
                {e.isAssumption && e.interpretationNote && <Note text={e.interpretationNote} />}
                {!e.isAssumption && e.interpretationNote && <Note text={e.interpretationNote} neutral />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="text-slate-700">
          <span className="font-medium text-slate-900">Submission:</span> {describeSubmission(data.submission)}
        </p>
      </section>
    </div>
  );
}

function CriterionItem({ index, c, compact }: { index: number; c: Criterion; compact: boolean }) {
  return (
    <li id={`criterion-${c.key}`} className="rounded-lg border border-slate-200 p-3">
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{c.displayLabel || <em className="text-slate-400">Untitled</em>}</span>
            <code className="rounded bg-slate-100 px-1 text-[11px] text-slate-500">{c.key}</code>
            {c.evaluationMode === "human_review" && <Pill tone="violet">Human review</Pill>}
            {c.isAssumption && <AssumptionBadge />}
          </div>
          <p className="mt-1 text-slate-800">{describeCriterion(c)}</p>
          {!compact && <Citation section={c.sourceCitation.section} excerpt={c.sourceCitation.excerpt} />}
          {c.interpretationNote && <Note text={c.interpretationNote} neutral={!c.isAssumption} />}
        </div>
      </div>
    </li>
  );
}

export function Citation({ section, excerpt }: { section: string; excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Source text · {section || "no section"}
      </button>
      {open && (
        <blockquote className="mt-1 border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs italic text-slate-700">
          {excerpt || <span className="not-italic text-rose-600">No excerpt.</span>}
        </blockquote>
      )}
    </div>
  );
}

function Note({ text, neutral }: { text: string; neutral?: boolean }) {
  return (
    <p className={`mt-1.5 rounded-md px-2 py-1 text-xs ${neutral ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-900"}`}>
      <span className="font-medium">{neutral ? "Interpretation:" : "Assumption:"}</span> {text}
    </p>
  );
}

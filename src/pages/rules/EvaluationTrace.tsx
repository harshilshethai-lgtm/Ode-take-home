import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FlaskConical, RotateCcw } from "lucide-react";
import { Citation } from "@/components/rules/RuleView";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { inputCls } from "@/components/rules/fields";
import { AssumptionBadge, Banner, Button, Card, CriterionStatusBadge, EmptyState, ExceptionStatusBadge, OverallBadge, Pill, SectionTitle, VersionStatusBadge } from "@/components/rules/ui";
import { ApiError } from "@/data/rules/service";
import { SOURCE_LABEL, humanize } from "@/domain/rules/common";
import { planTypeLabel } from "@/domain/rules/describe";
import type { CriterionResult, FactRef } from "@/domain/rules/types";
import { useRulesUser } from "@/lib/rulesUser";
import { fmtDateTime } from "@/lib/rulesFormat";
import { useRules } from "@/lib/useRules";

export default function EvaluationTrace() {
  const { id = "" } = useParams();
  const api = useRules();
  const { user } = useRulesUser();
  const navigate = useNavigate();
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  let trace: ReturnType<typeof api.getEvaluation>;
  try {
    trace = api.getEvaluation(id);
  } catch {
    return (
      <main className="mx-auto max-w-[1000px] px-6 py-6">
        <RulesHeader crumbs={[{ label: "Evaluation" }]} />
        <EmptyState>That evaluation does not exist.</EmptyState>
      </main>
    );
  }
  const { evaluation: e, version, policy, payer, supersededBy } = trace;
  const snap = e.rulesSnapshot;
  const versionLink = policy && version ? `/settings/rules/${policy.id}/versions/${version.id}` : null;
  const rerunDate = serviceDate ?? e.serviceDate;
  const hasAssumptions = !!snap && (snap.criteria.some((c) => c.isAssumption) || snap.exceptions.some((x) => x.isAssumption));

  const rerun = () => {
    try {
      const next = api.rerunEvaluation(e.id, { serviceDate: rerunDate });
      setServiceDate(null);
      navigate(`/evaluations/${next.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not re-run.");
    }
  };

  const saveAsTest = () => {
    const name = window.prompt("Name this test case", `${snap?.externalPolicyId ?? ""} · order ${e.orderRef}`);
    if (name === null) return;
    try {
      const tc = api.saveEvaluationAsTestCase(e.id, name, user);
      setSaved(tc.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1000px] px-6 py-6">
      <RulesHeader crumbs={policy && payer ? [{ label: "Prior-auth rules", to: "/settings/rules" }, { label: `${payer.name} ${policy.externalPolicyId}`, to: `/settings/rules/${policy.id}?tab=usage` }, { label: `Evaluation ${e.id.replace("eval_", "#")}` }] : [{ label: `Evaluation ${e.id.replace("eval_", "#")}` }]} />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            Evaluation {e.id.replace("eval_", "#")} <OverallBadge overall={e.overall} />
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Order <Link to={`/case/${e.orderRef}`} className="text-indigo-700 hover:underline">{e.orderRef}</Link> · patient {e.patientRef} · CPT {e.cptCode} · {planTypeLabel(e.planType)} · service date {e.serviceDate}
            {e.input.laterality ? ` · ${e.input.laterality}` : ""}
          </p>
          <p className="text-xs text-slate-500">Run {fmtDateTime(e.createdAt)} · engine {e.engineVersion}</p>
        </div>
        <Button onClick={saveAsTest} disabled={!snap}><FlaskConical size={14} /> Save as test case</Button>
      </div>

      {error && <div className="mb-3"><Banner tone="rose">{error}</Banner></div>}
      {saved && <div className="mb-3"><Banner tone="emerald">Saved as test case “{saved}”. It will run against every future draft of this policy.</Banner></div>}

      {version && supersededBy && (
        <div className="mb-4">
          <Banner tone="amber" action={<Button className="shrink-0" onClick={rerun}><RotateCcw size={14} /> Re-run under current rules</Button>}>
            <div>
              Evaluated under v{version.versionNumber} (superseded by v{supersededBy.versionNumber} on {supersededBy.effectiveFrom}). Re-run under current rules?
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                Service date for the re-run
                <input type="date" value={rerunDate} onChange={(ev) => setServiceDate(ev.target.value)} className={`${inputCls} !w-auto !py-0.5 text-xs`} />
              </label>
              {rerunDate < supersededBy.effectiveFrom! && (
                <span>The service date is before v{supersededBy.versionNumber} takes effect, so v{version.versionNumber} still governs it. Move the date if the scan was rescheduled.</span>
              )}
            </div>
          </Banner>
        </div>
      )}

      {e.overall === "no_policy_found" && (
        <Card className="mb-4">
          <div className="px-5 py-4">
            <h2 className="mb-1 text-sm font-semibold">No policy found</h2>
            <p className="text-sm text-slate-700">{e.noPolicyMessage}</p>
            <p className="mt-2 text-xs text-slate-500">Reason: {humanize(e.noPolicyReason ?? "")}. A person needs to check whether this order needs prior authorization.</p>
          </div>
        </Card>
      )}

      {snap && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <div className="text-xs text-slate-500">Policy and version used</div>
              <div className="flex flex-wrap items-center gap-2">
                {versionLink ? (
                  <Link to={versionLink} className="font-medium text-indigo-700 hover:underline">
                    {snap.payerName} {snap.externalPolicyId} · v{snap.versionNumber}
                  </Link>
                ) : (
                  <span className="font-medium">{snap.payerName} {snap.externalPolicyId} · v{snap.versionNumber}</span>
                )}
                {version && <VersionStatusBadge status={version.derivedStatus} />}
                {hasAssumptions && <AssumptionBadge title="This version contains assumptions that have not been confirmed with the payer." />}
              </div>
              <div className="text-xs text-slate-500">
                {snap.title}
                {snap.sourceRevisionLabel ? ` · insurer revision: ${snap.sourceRevisionLabel}` : ""}
                {version?.effectiveFrom ? ` · effective ${version.effectiveFrom}${version.effectiveTo ? ` to ${version.effectiveTo}` : ""}` : ""}
              </div>
            </div>
            {versionLink && <Link to={versionLink} className="text-sm text-indigo-700 hover:underline">View this exact version</Link>}
          </div>
        </Card>
      )}

      {e.submissionBlocked && (
        <div className="mb-4"><Banner tone="rose"><strong>Submission blocked.</strong> {e.submissionBlockedMessage}</Banner></div>
      )}

      {e.missingInfoChecklist.length > 0 && (
        <Card className="mb-4">
          <div className="px-5 py-4">
            <SectionTitle>Missing-info checklist</SectionTitle>
            <ul className="space-y-2">
              {e.missingInfoChecklist.map((m) => (
                <li key={m.criterionKey} className="flex gap-2 text-sm">
                  <input type="checkbox" disabled aria-label={`${m.displayLabel} outstanding`} className="mt-1" />
                  <div>
                    <div className="font-medium text-slate-900">{m.displayLabel}</div>
                    <div className="text-slate-700">{m.requirement}</div>
                    <div className="text-xs text-slate-500">{m.reason.split("): ").slice(1).join("): ") || m.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {e.exceptionResults.length > 0 && (
        <Card className="mb-4">
          <div className="px-5 py-4">
            <SectionTitle>Exceptions</SectionTitle>
            <ul className="space-y-2">
              {e.exceptionResults.map((x) => (
                <li key={x.exceptionKey} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{x.displayLabel}</span>
                    <ExceptionStatusBadge status={x.status} />
                    {x.isAssumption && <AssumptionBadge />}
                  </div>
                  {x.status !== "not_triggered" ? (
                    <p className="text-slate-700">
                      Triggered by {x.triggeredBy.map(humanize).join(", ")}; waives {x.waivesCriterionKeys.map((k) => e.criterionResults.find((r) => r.criterionKey === k)?.displayLabel ?? k).join(", ")}.
                      {x.status === "needs_review" && " A clinician must confirm."}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">No trigger documented.</p>
                  )}
                  {x.evidenceRefs.length > 0 && <Evidence refs={x.evidenceRefs} orderRef={e.orderRef} />}
                  <Citation section={x.sourceCitation.section} excerpt={x.sourceCitation.excerpt} />
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {e.criterionResults.length > 0 && (
        <Card>
          <div className="px-5 py-4">
            <SectionTitle>Criteria</SectionTitle>
            <ol className="space-y-3">
              {e.criterionResults.map((r) => (
                <CriterionRow key={r.criterionKey} r={r} orderRef={e.orderRef} versionLink={versionLink} />
              ))}
            </ol>
          </div>
        </Card>
      )}
    </main>
  );
}

function CriterionRow({ r, orderRef, versionLink }: { r: CriterionResult; orderRef: string; versionLink: string | null }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CriterionStatusBadge status={r.status} />
        <span className="font-medium text-slate-900">{r.displayLabel}</span>
        <code className="rounded bg-slate-100 px-1 text-[11px] text-slate-500">{r.criterionKey}</code>
        {r.isAssumption && <AssumptionBadge />}
        {r.waivedByExceptionKey && <Pill tone="sky">Waived by {humanize(r.waivedByExceptionKey)}</Pill>}
      </div>
      <p className="mt-1.5 text-sm text-slate-800">{r.reason}</p>
      <p className="mt-1 text-xs text-slate-500">Rule: {r.ruleText}</p>
      {r.evidenceRefs.length > 0 && <Evidence refs={r.evidenceRefs} orderRef={orderRef} />}
      <div className="flex flex-wrap items-center gap-3">
        <Citation section={r.sourceCitation.section} excerpt={r.sourceCitation.excerpt} />
        {versionLink && (
          <Link to={`${versionLink}#criterion-${r.criterionKey}`} className="mt-1.5 text-xs text-indigo-700 hover:underline">
            View criterion in policy
          </Link>
        )}
      </div>
    </li>
  );
}

function Evidence({ refs, orderRef }: { refs: FactRef[]; orderRef: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {refs.map((f) => (
        <li key={f.factId} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
          <span className="font-medium">{SOURCE_LABEL[f.sourceType]}</span> · {f.date} ·{" "}
          <Link to={`/case/${orderRef}?doc=${f.sourceDocumentId}`} className="text-indigo-700 hover:underline">
            {f.sourceDocumentId}
          </Link>
          <div className="italic text-slate-600">“{f.excerpt}”</div>
        </li>
      ))}
    </ul>
  );
}

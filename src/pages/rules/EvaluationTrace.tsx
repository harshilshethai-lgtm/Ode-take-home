import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, FlaskConical, RotateCcw } from "lucide-react";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { AssumptionBadge, Banner, Button, Card, CriterionStatusBadge, EmptyState, ExceptionStatusBadge, OverallBadge, Pill, SectionTitle, VersionStatusBadge } from "@/components/rules/ui";
import { ApiError } from "@/data/rules/service";
import { SOURCE_LABEL, humanize } from "@/domain/rules/common";
import { planTypeLabel } from "@/domain/rules/describe";
import { STATUS_LABEL } from "@/domain/rules/engine";
import type { CriterionResult, FactRef } from "@/domain/rules/types";
import { affectedList, checkedAgainstText, rulesChangedText, versionHref } from "@/lib/evalNotice";
import { useRulesUser } from "@/lib/rulesUser";
import { caseHref, fmtDateTime } from "@/lib/rulesFormat";
import { useRules } from "@/lib/useRules";

export default function EvaluationTrace() {
  const { id = "" } = useParams();
  const api = useRules();
  const { user } = useRulesUser();
  const navigate = useNavigate();
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
  const { evaluation: e, version, policy, payer, staleness } = trace;
  const snap = e.rulesSnapshot;
  const versionLink = policy && version ? versionHref(policy.id, version.id) : null;
  const hasAssumptions = !!snap && (snap.criteria.some((c) => c.isAssumption) || snap.exceptions.some((x) => !!x.assumption));

  const rerun = () => {
    try {
      const next = api.recheckEvaluation(e.id, user.name);
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
            Order <OrderLink orderRef={e.orderRef} /> · patient {e.patientRef} · CPT {e.cptCode} · {planTypeLabel(e.planType)} · service date {e.serviceDate}
            {e.input.laterality ? ` · ${e.input.laterality}` : ""}
          </p>
          <p className="text-xs text-slate-500">Run {fmtDateTime(e.createdAt)} · engine {e.engineVersion}</p>
        </div>
        <Button onClick={saveAsTest} disabled={!snap}><FlaskConical size={14} /> Save as test case</Button>
      </div>

      {error && <div className="mb-3"><Banner tone="rose">{error}</Banner></div>}
      {saved && <div className="mb-3"><Banner tone="emerald">Saved as test case “{saved}”. It will run against every future draft of this policy.</Banner></div>}

      {staleness && (
        <div className="mb-4">
          <Banner tone="amber" action={<Button className="shrink-0" onClick={rerun}><RotateCcw size={14} /> Re-run →</Button>}>
            <div>{rulesChangedText(staleness.pinned.versionNumber, staleness.applicable.versionNumber, staleness.affected, staleness.affectedWaivers)}</div>
            {staleness.affected.length > 0 && <div className="mt-1 text-xs">Changed: {affectedList(staleness.affected)}</div>}
            {staleness.affectedWaivers.length > 0 && <div className="mt-1 text-xs">Waivers: {affectedList(staleness.affectedWaivers)}</div>}
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
                    {checkedAgainstText(snap)}
                  </Link>
                ) : (
                  <span className="font-medium">{checkedAgainstText(snap)}</span>
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
                  <Citation section={x.ref} excerpt={x.excerpt} />
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
      {r.propertyResults && r.propertyResults.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
          {r.propertyResults.map((p) => (
            <li key={p.key}>
              <span className="font-medium text-slate-800">{p.label}</span> · {STATUS_LABEL[p.status]} · {p.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Rule: {r.ruleText}</p>
      )}
      {r.evidenceRefs.length > 0 && <Evidence refs={r.evidenceRefs} orderRef={orderRef} />}
      <div className="flex flex-wrap items-center gap-3">
        <Citation section={r.ref} excerpt={r.excerpt} />
        {versionLink && (
          <Link to={versionLink} className="mt-1.5 text-xs text-indigo-700 hover:underline">
            View criterion in policy
          </Link>
        )}
      </div>
    </li>
  );
}

function Citation({ section, excerpt }: { section: string; excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Source · {section || "no reference"}
      </button>
      {open && (
        <blockquote className="mt-1 border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs italic text-slate-700">
          {excerpt || <span className="not-italic text-rose-600">No excerpt.</span>}
        </blockquote>
      )}
    </div>
  );
}

/** Links to the case when the order is on the worklist; plain text otherwise. */
function OrderLink({ orderRef, doc, children }: { orderRef: string; doc?: string; children?: React.ReactNode }) {
  const href = caseHref(orderRef, doc);
  const text = children ?? orderRef;
  return href ? <Link to={href} className="text-indigo-700 hover:underline">{text}</Link> : <span>{text}</span>;
}

function Evidence({ refs, orderRef }: { refs: FactRef[]; orderRef: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {refs.map((f) => (
        <li key={f.factId} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
          <span className="font-medium">{SOURCE_LABEL[f.sourceType]}</span> · {f.date} ·{" "}
          <OrderLink orderRef={orderRef} doc={f.sourceDocumentId}>{f.sourceDocumentId}</OrderLink>
          <div className="italic text-slate-600">“{f.excerpt}”</div>
        </li>
      ))}
    </ul>
  );
}

// Deterministic rule engine. Consumes structured, sourced facts; never reads notes.
// No payer-specific branches: every difference between payers is data in the rules snapshot.

import { factRef, humanize } from "./common";
import { describeCriterion } from "./describe";
import { getPrimitive } from "./primitives/registry";
import { resolvePolicyVersion, type Catalog } from "./resolve";
import type {
  CriterionResult,
  CriterionStatus,
  EvaluationContext,
  EvaluationInput,
  EvaluationOutcome,
  ExceptionResult,
  MissingInfoItem,
  OverallStatus,
  Payer,
  Policy,
  PolicyVersion,
  RulesSnapshot,
} from "./types";

export const ENGINE_VERSION = "1.0.0";

export const SUBMISSION_BLOCKED_MESSAGE =
  "This payer does not allow amending incomplete requests; resolve all items before submitting.";

export const STATUS_LABEL: Record<CriterionStatus, string> = {
  met: "Met",
  not_met: "Not met",
  unknown: "Unknown",
  needs_review: "Needs review",
  waived: "Waived",
};

export function buildSnapshot(payer: Payer, policy: Policy, version: PolicyVersion): RulesSnapshot {
  return {
    payerName: payer.name,
    policyId: policy.id,
    externalPolicyId: policy.externalPolicyId,
    title: policy.title,
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceRevisionLabel: version.sourceRevisionLabel,
    sourceDocument: version.sourceDocument,
    sourceDocumentHash: version.sourceDocumentHash,
    applicability: structuredClone(version.applicability),
    logic: version.logic,
    submission: structuredClone(version.submission),
    criteria: [...version.criteria]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        key: c.key,
        displayLabel: c.displayLabel,
        type: c.type,
        params: structuredClone(c.params),
        evaluationMode: c.evaluationMode,
        sourceCitation: { ...c.sourceCitation },
        interpretationNote: c.interpretationNote,
        isAssumption: c.isAssumption,
        text: describeCriterion(c),
      })),
    exceptions: version.exceptions.map((e) => ({
      key: e.key,
      displayLabel: e.displayLabel,
      triggers: [...e.triggers],
      waivesCriterionKeys: [...e.waivesCriterionKeys],
      evaluationMode: e.evaluationMode,
      sourceCitation: { ...e.sourceCitation },
      interpretationNote: e.interpretationNote,
      isAssumption: e.isAssumption,
    })),
  };
}

/** any not_met -> not_eligible; else any unknown -> missing_info; else any needs_review -> needs_review; else approve_ready. */
export function rollupOverall(
  criterionStatuses: CriterionStatus[],
  exceptionNeedsReview = false,
): OverallStatus {
  if (criterionStatuses.includes("not_met")) return "not_eligible";
  if (criterionStatuses.includes("unknown")) return "missing_info";
  if (criterionStatuses.includes("needs_review") || exceptionNeedsReview) return "needs_review";
  // Nothing evaluated is not an approval.
  if (criterionStatuses.length === 0) return "needs_review";
  return "approve_ready";
}

function citationPrefix(s: RulesSnapshot, section: string): string {
  return `${s.payerName} ${s.externalPolicyId}, v${s.versionNumber}, ${section}`;
}

/** Evaluate against a frozen snapshot. Same snapshot + same input = same outcome. */
export function evaluateSnapshot(snapshot: RulesSnapshot, input: Omit<EvaluationInput, "payerId">): EvaluationOutcome {
  const ctx: EvaluationContext = {
    serviceDate: input.serviceDate,
    laterality: input.laterality,
    cptCode: input.cptCode,
    planType: input.planType,
  };

  // 1. Exceptions first.
  const exceptionResults: ExceptionResult[] = [];
  const waivedBy = new Map<string, { key: string; label: string; humanReview: boolean; trigger: string; section: string; refs: ReturnType<typeof factRef>[] }>();
  for (const ex of snapshot.exceptions) {
    const hits = input.facts.filter((f) => f.type === "exception_condition" && typeof f.value === "string" && ex.triggers.includes(f.value));
    const triggered = hits.length > 0;
    const status = !triggered ? "not_triggered" : ex.evaluationMode === "human_review" ? "needs_review" : "applied";
    const triggeredBy = [...new Set(hits.map((h) => String(h.value)))];
    exceptionResults.push({
      exceptionKey: ex.key,
      displayLabel: ex.displayLabel,
      status,
      triggeredBy,
      evidenceRefs: hits.map(factRef),
      waivesCriterionKeys: ex.waivesCriterionKeys,
      sourceCitation: ex.sourceCitation,
      isAssumption: ex.isAssumption,
    });
    if (triggered) {
      for (const k of ex.waivesCriterionKeys) {
        if (!waivedBy.has(k)) {
          waivedBy.set(k, {
            key: ex.key,
            label: ex.displayLabel,
            humanReview: ex.evaluationMode === "human_review",
            trigger: humanize(triggeredBy[0]),
            section: ex.sourceCitation.section,
            refs: hits.map(factRef),
          });
        }
      }
    }
  }

  // 2 + 3. Waived criteria are not evaluated; the rest run through their primitive.
  const criterionResults: CriterionResult[] = snapshot.criteria.map((c) => {
    const cite = citationPrefix(snapshot, c.sourceCitation.section);
    const base = {
      criterionKey: c.key,
      displayLabel: c.displayLabel,
      sourceCitation: c.sourceCitation,
      ruleText: c.text,
      isAssumption: c.isAssumption,
    };
    const compose = (status: CriterionStatus, detail: string) =>
      `${STATUS_LABEL[status]}. ${c.displayLabel} (${cite}): ${detail}`;

    const waiver = waivedBy.get(c.key);
    if (waiver) {
      const detail = waiver.humanReview
        ? `Waived pending clinical confirmation: exception "${waiver.label}" (${waiver.section}) applies because ${waiver.trigger} was documented.`
        : `Waived: exception "${waiver.label}" (${waiver.section}) applies because ${waiver.trigger} was documented.`;
      return { ...base, status: "waived", reason: compose("waived", detail), evidenceRefs: waiver.refs, waivedByExceptionKey: waiver.key };
    }

    const prim = getPrimitive(c.type);
    const parsed = prim?.paramsSchema.safeParse(c.params);
    if (!prim || !parsed?.success) {
      const detail = `This rule could not be evaluated (${prim ? "invalid parameters" : `unknown rule type "${c.type}"`}); a person must review it.`;
      return { ...base, status: "needs_review", reason: compose("needs_review", detail), evidenceRefs: [] };
    }

    const r = prim.evaluate(parsed.data, input.facts, ctx);
    if (c.evaluationMode === "human_review" && r.status === "met") {
      const detail = `${r.detail} This criterion is set to human review, so a person must confirm it.`;
      return { ...base, status: "needs_review", reason: compose("needs_review", detail), evidenceRefs: r.evidenceRefs };
    }
    return { ...base, status: r.status, reason: compose(r.status, r.detail), evidenceRefs: r.evidenceRefs };
  });

  // 4. Overall.
  const overall = rollupOverall(
    criterionResults.map((r) => r.status),
    exceptionResults.some((e) => e.status === "needs_review"),
  );

  // 5. Missing-info checklist and submission gate.
  const missingInfoChecklist: MissingInfoItem[] = criterionResults
    .filter((r) => r.status === "unknown")
    .map((r) => ({
      criterionKey: r.criterionKey,
      displayLabel: r.displayLabel,
      requirement: r.ruleText,
      reason: r.reason,
    }));
  const submissionBlocked =
    snapshot.submission.incompleteRequestHandling === "deny_resubmit_new" && missingInfoChecklist.length > 0;

  return {
    overall,
    criterionResults,
    exceptionResults,
    missingInfoChecklist,
    submissionBlocked,
    ...(submissionBlocked ? { submissionBlockedMessage: SUBMISSION_BLOCKED_MESSAGE } : {}),
    rulesSnapshot: snapshot,
  };
}

/** Resolve the governing version for the order, then evaluate. Returns no_policy_found with a reason if none. */
export function evaluateOrder(
  cat: Catalog,
  input: EvaluationInput,
): { outcome: EvaluationOutcome; policyVersionId: string | null } {
  const res = resolvePolicyVersion(cat, input);
  if (!res.found) {
    return {
      policyVersionId: null,
      outcome: {
        overall: "no_policy_found",
        criterionResults: [],
        exceptionResults: [],
        missingInfoChecklist: [],
        submissionBlocked: false,
        noPolicyReason: res.reason,
        noPolicyMessage: res.message,
        rulesSnapshot: null,
      },
    };
  }
  const snapshot = buildSnapshot(res.payer, res.policy, res.version);
  return { policyVersionId: res.version.id, outcome: evaluateSnapshot(snapshot, input) };
}

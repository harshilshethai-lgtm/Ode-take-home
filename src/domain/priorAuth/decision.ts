import type { ConsistencyCheckId, CriterionResult, CriterionResultCode, RoutingPolicy, RoutingContext } from "./types";
import type { OrderStatus } from "./types";
import { resolveRouting } from "./routing";

export type EvaluatingStatus = Extract<OrderStatus, "NEEDS_CORRECTION" | "CLINICAL_REVIEW" | "AWAITING_DOCUMENTS" | "READY_TO_SUBMIT">;

export type DecisionRule = "E1" | "E2" | "E3" | "E4" | "E5" | "E6";

const PASSING: readonly CriterionResultCode[] = ["MET", "WAIVED", "EXCEPTION_MET"];

export interface ConsistencyFailure {
  id: ConsistencyCheckId | string;
  detail: string;
}

export interface PageIssue {
  checkId: "PP-2" | "PP-3" | "PP-4";
  /** Only issues that hold required evidence move the order to Awaiting documents. */
  holdsRequiredEvidence: boolean;
  detail: string;
}

export interface EvaluatingInput {
  consistencyFailures?: ConsistencyFailure[];
  criteria: CriterionResult[];
  /** A passing result below this value counts as UNCLEAR. Per-criterion `threshold` wins. */
  confidenceThreshold: number;
  pageIssues?: PageIssue[];
  /** True when the order has been in Awaiting documents or Needs correction since it last left Approval check. */
  coordinatorFixSinceApprovalCheck?: boolean;
  /** How many times the order has already entered Awaiting documents. */
  priorAwaitingDocumentsEntries?: number;
  /** The gap that was just filled, used in the confirm-only reason. */
  resolvedItem?: string;
  previousCriteria?: CriterionResult[];
  /** Criterion ids the missing item was supposed to fix. */
  fixedCriterionIds?: string[];
  routingPolicy?: RoutingPolicy;
  routingContext?: RoutingContext;
  /** Named in the loop-guard reason. */
  requestedItems?: string[];
}

export interface EvaluatingDecision {
  status: EvaluatingStatus;
  reason: string;
  confirmOnly: boolean;
  checkIds: string[];
  rule: DecisionRule;
}

/**
 * What EVALUATING decides. Pure: same input, same answer.
 * E1 consistency, E2 clinical not-met, E3 document gaps, E4 ready.
 * E5 reroutes a clean re-check after a coordinator fix. E6 stops a third document chase.
 * UNCLEAR never counts as MET. Patient-reported treatment is not documentation.
 */
export function decideEvaluating(input: EvaluatingInput): EvaluatingDecision {
  const criteria = normalizeCriteria(input.criteria, input.confidenceThreshold);
  const consistency = input.consistencyFailures ?? [];
  const base = firstMatch(criteria, consistency, input.pageIssues ?? []);
  const routed = applyCoordinatorRouting(base, criteria, input);
  return applyLoopGuard(routed, input);
}

function firstMatch(criteria: CriterionResult[], consistency: ConsistencyFailure[], pageIssues: PageIssue[]): EvaluatingDecision {
  if (consistency.length > 0) {
    return {
      status: "NEEDS_CORRECTION",
      reason: consistency.map((c) => c.detail).filter(Boolean).join("; ") || "Conflict needs correction",
      confirmOnly: false,
      checkIds: consistency.map((c) => c.id),
      rule: "E1",
    };
  }

  const clinical = criteria.filter((c) => c.result === "NOT_MET" && c.failureClass === "clinical");
  if (clinical.length > 0) {
    const gaps = documentGaps(criteria, pageIssues);
    const parts = [...clinical.map(criterionLine), ...gaps.map((g) => g.line)];
    return {
      status: "CLINICAL_REVIEW",
      reason: parts.join("; "),
      confirmOnly: false,
      checkIds: gaps.map((g) => g.checkId),
      rule: "E2",
    };
  }

  const gaps = documentGaps(criteria, pageIssues);
  if (gaps.length > 0) {
    return {
      status: "AWAITING_DOCUMENTS",
      reason: gaps[0].line,
      confirmOnly: false,
      checkIds: gaps.map((g) => g.checkId),
      rule: "E3",
    };
  }

  return {
    status: "READY_TO_SUBMIT",
    reason: "All criteria met",
    confirmOnly: false,
    checkIds: [],
    rule: "E4",
  };
}

function applyCoordinatorRouting(base: EvaluatingDecision, criteria: CriterionResult[], input: EvaluatingInput): EvaluatingDecision {
  if (base.status !== "READY_TO_SUBMIT" || !input.coordinatorFixSinceApprovalCheck) return base;
  if (!input.routingPolicy) return base;

  const resolved = resolveRouting(input.routingPolicy, input.routingContext ?? {});
  if (resolved.mode === "straight_to_submission") return { ...base, rule: "E5" };
  if (resolved.mode === "nurse_signoff") return confirmOnly(input);
  if (onlyFixedCriteriaChanged(criteria, input) && allAboveThreshold(criteria, input.confidenceThreshold)) {
    return { ...base, rule: "E5" };
  }
  return confirmOnly(input);
}

function confirmOnly(input: EvaluatingInput): EvaluatingDecision {
  const item = input.resolvedItem?.trim() || "records";
  return {
    status: "CLINICAL_REVIEW",
    reason: `Confirm: ${item} received`,
    confirmOnly: true,
    checkIds: [],
    rule: "E5",
  };
}

function applyLoopGuard(decision: EvaluatingDecision, input: EvaluatingInput): EvaluatingDecision {
  const prior = input.priorAwaitingDocumentsEntries ?? 0;
  if (decision.status !== "AWAITING_DOCUMENTS" || prior < 2) return decision;
  const items = (input.requestedItems ?? []).filter(Boolean);
  const list = items.length > 0 ? items.join(", ") : decision.reason;
  return {
    status: "CLINICAL_REVIEW",
    reason: `Documents requested 3 times: ${list}`,
    confirmOnly: false,
    checkIds: decision.checkIds,
    rule: "E6",
  };
}

function normalizeCriteria(criteria: CriterionResult[], fallbackThreshold: number): CriterionResult[] {
  return criteria.map((c) => {
    if (c.sourceKind === "patient_reported" && c.documentationRequired !== false) {
      return { ...c, result: "UNCLEAR", failureClass: "documents" };
    }
    const passing = PASSING.includes(c.result);
    if (passing && c.confidence < (c.threshold ?? fallbackThreshold)) {
      return { ...c, result: "UNCLEAR", failureClass: "documents" };
    }
    if ((c.result === "NOT_MET" || c.result === "UNCLEAR") && c.failureClass == null) {
      return { ...c, failureClass: c.result === "NOT_MET" ? "clinical" : "documents" };
    }
    return c;
  });
}

function documentGaps(criteria: CriterionResult[], pageIssues: PageIssue[]): { checkId: string; line: string }[] {
  const fromCriteria = criteria
    .filter((c) => c.result === "UNCLEAR" || (c.result === "NOT_MET" && c.failureClass === "documents"))
    .map((c) => ({ checkId: c.criterionId, line: criterionLine(c) }));
  const fromPages = pageIssues
    .filter((p) => p.holdsRequiredEvidence)
    .map((p) => ({ checkId: p.checkId, line: p.detail }));
  return [...fromPages, ...fromCriteria];
}

function criterionLine(c: CriterionResult): string {
  const name = c.label ?? c.criterionId;
  const quote = c.evidence?.quote;
  return quote ? `${name}: ${quote}` : name;
}

function onlyFixedCriteriaChanged(criteria: CriterionResult[], input: EvaluatingInput): boolean {
  const previous = input.previousCriteria;
  if (!previous) return false;
  const fixed = new Set(input.fixedCriterionIds ?? []);
  if (previous.length !== criteria.length) return false;
  for (const current of criteria) {
    const before = previous.find((p) => p.criterionId === current.criterionId);
    if (!before) return false;
    const changed = before.result !== current.result || before.failureClass !== current.failureClass || before.confidence !== current.confidence;
    if (changed && !fixed.has(current.criterionId)) return false;
  }
  return true;
}

function allAboveThreshold(criteria: CriterionResult[], fallback: number): boolean {
  return criteria.every((c) => c.confidence >= (c.threshold ?? fallback));
}

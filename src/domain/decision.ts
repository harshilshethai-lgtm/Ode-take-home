// Thin adapter over the prior-auth decision so existing callers keep their types.
// Below a confidence threshold counts as UNCLEAR, and UNCLEAR never counts as Met.

import { decideEvaluating } from "./priorAuth/decision";
import type { StatusId } from "./statuses";

export type CriterionResult = "met" | "waived" | "exception_met" | "not_met" | "unclear";
export type FailClass = "clinical" | "documents";

export interface CriterionOutcome {
  id: string;
  result: CriterionResult;
  failClass: FailClass;
  confidence: number;
}

export interface DecisionInput {
  failedConsistencyChecks: string[];
  criteria: CriterionOutcome[];
  confidenceThreshold: number;
}

export type DecisionStatus = Extract<StatusId, "needs_correction" | "clinical_review" | "awaiting_documents" | "ready_to_submit">;

const RESULT = {
  met: "MET",
  waived: "WAIVED",
  exception_met: "EXCEPTION_MET",
  not_met: "NOT_MET",
  unclear: "UNCLEAR",
} as const;

export function decide(input: DecisionInput): DecisionStatus {
  const decision = decideEvaluating({
    consistencyFailures: input.failedConsistencyChecks.map((id) => ({ id, detail: id })),
    criteria: input.criteria.map((c) => ({
      criterionId: c.id,
      result: RESULT[c.result],
      failureClass: c.result === "not_met" || c.result === "unclear" ? c.failClass : null,
      confidence: c.confidence,
      evidence: null,
    })),
    confidenceThreshold: input.confidenceThreshold,
  });
  switch (decision.status) {
    case "NEEDS_CORRECTION":
      return "needs_correction";
    case "CLINICAL_REVIEW":
      return "clinical_review";
    case "AWAITING_DOCUMENTS":
      return "awaiting_documents";
    case "READY_TO_SUBMIT":
      return "ready_to_submit";
  }
}

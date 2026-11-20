// Decision logic from PRD §Evaluating. Deterministic: same facts, same answer.
// The AI only extracts facts and per-criterion results; routing is decided here.

import type { StatusId } from "./statuses";

export type CriterionResult = "met" | "waived" | "exception_met" | "not_met" | "unclear";
export type FailClass = "clinical" | "documents";

export interface CriterionOutcome {
  id: string;
  result: CriterionResult;
  failClass: FailClass;
  /** Extraction confidence 0..1. */
  confidence: number;
}

export interface DecisionInput {
  /** IDs of consistency checks (CO-1..CO-5) that failed. */
  failedConsistencyChecks: string[];
  criteria: CriterionOutcome[];
  /** Minimum confidence for a criterion to count as passing. */
  confidenceThreshold: number;
}

export type DecisionStatus = Extract<
  StatusId,
  "needs_correction" | "clinical_review" | "awaiting_documents" | "ready_to_submit"
>;

const PASSING: CriterionResult[] = ["met", "waived", "exception_met"];

export function decide(input: DecisionInput): DecisionStatus {
  // 1. Any consistency check fails → Needs correction
  if (input.failedConsistencyChecks.length > 0) return "needs_correction";

  // 2. Any criterion Not met and tagged clinical → Clinical review
  if (input.criteria.some((c) => c.result === "not_met" && c.failClass === "clinical")) {
    return "clinical_review";
  }

  // 3. Any criterion Unclear or fixable by documents → Awaiting documents
  //    ("Unclear never counts as Met")
  if (input.criteria.some((c) => c.result === "unclear" || c.result === "not_met")) {
    return "awaiting_documents";
  }

  // 4. Every criterion passing and above the confidence threshold → Ready to submit.
  //    A passing result below threshold is not certain enough to auto-submit; a nurse confirms it.
  const allConfident = input.criteria.every(
    (c) => PASSING.includes(c.result) && c.confidence >= input.confidenceThreshold,
  );
  return allConfident ? "ready_to_submit" : "clinical_review";
}

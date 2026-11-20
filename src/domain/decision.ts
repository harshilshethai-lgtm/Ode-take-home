// Thin adapter over the prior-auth bucket so existing callers keep their types.
// Below a confidence threshold counts as UNCLEAR, and UNCLEAR never counts as Met.

import { bucketRun } from "./priorAuth/bucket";
import { toStatusId } from "./priorAuth/legacy";
import type { StatusId } from "./statuses";
import type { Channel } from "./statuses";

export type CriterionResult = "met" | "waived" | "exception_met" | "not_met" | "unclear";
export type FailClass = "clinical" | "documents";

export interface CriterionOutcome {
  id: string;
  result: CriterionResult;
  failClass: FailClass;
  confidence: number;
  clinicalKind?: "duration" | "treatment_length" | "other";
  documentCouldChange?: boolean;
  pendingDocument?: "never_performed" | "elsewhere";
}

export interface DecisionInput {
  failedConsistencyChecks: string[];
  criteria: CriterionOutcome[];
  confidenceThreshold: number;
  /** API insurers are submitted. Portal insurers stop for an upload. */
  channel?: Channel | null;
}

export type DecisionStatus = StatusId;

const RESULT = {
  met: "MET",
  waived: "WAIVED",
  exception_met: "EXCEPTION_MET",
  not_met: "NOT_MET",
  unclear: "UNCLEAR",
} as const;

export function decide(input: DecisionInput): DecisionStatus {
  const decision = bucketRun({
    consistencyFailures: input.failedConsistencyChecks.map((id) => ({ id, detail: id })),
    criteria: input.criteria.map((c) => ({
      criterionId: c.id,
      result: RESULT[c.result],
      failureClass: c.result === "not_met" || c.result === "unclear" ? c.failClass : null,
      confidence: c.confidence,
      evidence: null,
      clinicalKind: c.clinicalKind,
      documentCouldChange: c.documentCouldChange,
      pendingDocument: c.pendingDocument,
    })),
    confidenceThreshold: input.confidenceThreshold,
    approvalRequired: true,
    hasCriteria: true,
    channel: input.channel === undefined ? "api" : input.channel,
    insurer: "the insurer",
    policyId: "the policy",
  });
  return toStatusId(decision.status);
}

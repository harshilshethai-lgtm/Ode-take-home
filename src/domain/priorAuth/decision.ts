// Kept so callers can pass the evaluating-step input. The bucket is the decision.

import { bucketRun, type BucketDecision, type BucketInput } from "./bucket";
import type { ConsistencyFailure, PageIssue } from "./bucket";
import type { CriterionResult, RoutingContext, RoutingPolicy } from "./types";

export type { BucketDecision as EvaluatingDecision, ConsistencyFailure, PageIssue };

export interface EvaluatingInput {
  consistencyFailures?: ConsistencyFailure[];
  criteria: CriterionResult[];
  confidenceThreshold: number;
  pageIssues?: PageIssue[];
  coordinatorFixSinceApprovalCheck?: boolean;
  priorAwaitingDocumentsEntries?: number;
  resolvedItem?: string;
  previousCriteria?: CriterionResult[];
  fixedCriterionIds?: string[];
  routingPolicy?: RoutingPolicy;
  routingContext?: RoutingContext;
  requestedItems?: string[];
}

export type DecisionRule = "1" | "2" | "3" | "4" | "5" | "6" | "7";

/** Criteria, consistency and routing only. Coverage and readability are bucketRun's job. */
export function decideEvaluating(input: EvaluatingInput): BucketDecision {
  const mapped: BucketInput = {
    criteria: input.criteria,
    confidenceThreshold: input.confidenceThreshold,
    consistencyFailures: input.consistencyFailures,
    pageIssues: input.pageIssues,
    priorMissingDocumentsEntries: input.priorAwaitingDocumentsEntries,
    requestedItems: input.requestedItems,
    coordinatorFix: input.coordinatorFixSinceApprovalCheck,
    resolvedItem: input.resolvedItem,
    previousCriteria: input.previousCriteria,
    fixedCriterionIds: input.fixedCriterionIds,
    routingPolicy: input.routingPolicy,
    routingContext: input.routingContext,
    approvalRequired: true,
    hasCriteria: true,
    channel: "api",
  };
  return bucketRun(mapped);
}

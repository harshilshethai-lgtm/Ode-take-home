// Gives every case that is checked against an insurer rule a stored evaluation. The case's recorded results are
// pinned to the version that governed the check, with that version's criteria copied in.

import type { CheckResult } from "@/domain/review/types";
import type { CriterionStatus } from "@/domain/rules/types";
import { getReviewPanel } from "@/domain/review/panel";
import type { Order } from "@/domain/types";
import type { RulesApi } from "./service";

const STATUS: Record<CheckResult, CriterionStatus> = {
  MET: "met",
  FIXED: "met",
  NOT_MET: "not_met",
  UNCLEAR: "unknown",
  WAIVED: "waived",
  EXCEPTION_MET: "waived",
};

const dateOf = (iso: string) => iso.slice(0, 10);

/** Record an evaluation for each order that has rule-based checks and none stored yet. Safe to run on every load. */
export function recordOrderEvaluations(api: RulesApi, orders: Order[]): number {
  const known = new Set(api.listEvaluations().map((e) => e.orderRef));
  const policies = new Map(api.listPolicies().map((s) => [s.policy.externalPolicyId, s.policy.id]));
  let recorded = 0;
  for (const order of orders) {
    if (!order.orderNumber || !order.policyRef || known.has(order.orderNumber)) continue;
    const policyId = policies.get(order.policyRef.split(" ")[0] ?? "");
    if (!policyId) continue;
    const { checks } = getReviewPanel(order.id, "coordinator", order);
    if (checks.criteria.rows.length === 0 || !checks.evaluatedAt) continue;
    const evaluatedAt = new Date(checks.evaluatedAt).toISOString();
    try {
      api.recordEvaluation({
        orderRef: order.orderNumber,
        patientRef: order.patient?.mrn ?? "",
        policyId,
        cptCode: order.cpt ?? "",
        planType: (order.plan ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        serviceDate: dateOf(order.scheduledAt ?? checks.evaluatedAt),
        evaluatedOn: dateOf(checks.evaluatedAt),
        createdAt: evaluatedAt,
        results: checks.criteria.rows.map((row) => ({ criterionKey: row.id, status: STATUS[row.result], reason: row.found })),
      });
      recorded += 1;
    } catch {
      // No version governed that date; leave the order without a stored check.
    }
  }
  return recorded;
}

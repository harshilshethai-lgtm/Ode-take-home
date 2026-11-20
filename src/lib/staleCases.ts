import type { RulesApi } from "@/data/rules/service";
import type { Evaluation } from "@/domain/rules/types";
import type { Staleness } from "@/domain/rules/staleness";
import type { StatusId } from "@/domain/statuses";
import type { Order } from "@/domain/types";

/** Statuses where the request has gone to the insurer or the case is closed. Everything else is unsubmitted. */
const SENT_OR_CLOSED = new Set<StatusId>(["submitted", "approved", "not_required", "denied", "cancelled"]);

export const isUnsubmitted = (o: Pick<Order, "status">) => !SENT_OR_CLOSED.has(o.status);

export interface StaleCase {
  order: Order;
  evaluation: Evaluation;
  staleness: Staleness;
}

/** Unsubmitted cases whose latest check used a version that is no longer the one that applies. */
export function staleCases(orders: Order[], api: Pick<RulesApi, "getLatestEvaluationFor" | "getStaleness">): StaleCase[] {
  return orders.flatMap((order) => {
    if (!order.orderNumber || !isUnsubmitted(order)) return [];
    const evaluation = api.getLatestEvaluationFor(order.orderNumber);
    const staleness = evaluation ? api.getStaleness(evaluation.id) : null;
    return evaluation && staleness ? [{ order, evaluation, staleness }] : [];
  });
}

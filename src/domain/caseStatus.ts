// One reading of a case: badge, worklist tab, and the activity log.
// Every status change is one event. A case never transitions to the status it already has.

import { guidanceFor } from "@/domain/guidance";
import { isLegalOrderTransition, ORDER_TRANSITIONS } from "@/domain/priorAuth/catalog";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { presentStatus } from "@/domain/priorAuth/render";
import type { ActivityEntry, Order } from "@/domain/types";
import { PARTITION_VIEWS, inView, toRow, type ViewId } from "@/lib/worklist";
import type { OrderStatus } from "@/domain/priorAuth/types";

export interface CaseProjection {
  label: string;
  tab: ViewId;
  reason: string;
  nextStep: string;
  /** Status changes only. `from` and `to` always differ. Newest first. */
  activity: ActivityEntry[];
}

export function statusLabelFor(order: Order): string {
  return presentStatus({
    status: toOrderStatus(order.status),
    reason: order.reasonCode,
    linkedApproval: order.linkedApproval === true,
  }).label;
}

export function worklistTab(order: Order): ViewId {
  const row = toRow(order);
  const tab = PARTITION_VIEWS.find((view) => inView(row, view));
  if (!tab) throw new Error(`No worklist tab for ${order.id}`);
  return tab;
}

/** Activity for the case page. Live pipeline notes stay, but a status never moves to itself. */
export function statusActivity(order: Order): ActivityEntry[] {
  if (order.pipelineActivity && order.pipelineActivity.length > 0) {
    return order.pipelineActivity.map(dropSelfTransition);
  }
  return machineTrail(order);
}

export function projectCase(order: Order): CaseProjection {
  const guide = guidanceFor(order);
  return {
    label: statusLabelFor(order),
    tab: worklistTab(order),
    reason: guide.reason,
    nextStep: guide.nextStep,
    activity: statusActivity(order),
  };
}

function dropSelfTransition(entry: ActivityEntry): ActivityEntry {
  if (entry.from && entry.from === entry.to) return { ...entry, from: "", to: "" };
  return entry;
}

/** Shortest legal path from Processing to the order's status. One activity event per hop. */
export function machineTrail(order: Order): ActivityEntry[] {
  const target = toOrderStatus(order.status);
  const path = pathFrom("PROCESSING", target);
  if (path.length < 2) return [];
  const hops = path.length - 1;
  const end = new Date(order.statusSince).getTime();
  return path.slice(1).map((status, index) => {
    const from = path[index];
    const at = new Date(end - (hops - 1 - index) * 60_000).toISOString();
    return {
      at,
      actor: "System",
      from: labelFor(from, from === target ? order : undefined),
      to: labelFor(status, status === target ? order : undefined),
      reason: status === target ? order.reason : "Status changed",
    };
  }).reverse();
}

function labelFor(status: OrderStatus, order: Order | undefined): string {
  if (order && toOrderStatus(order.status) === status) return statusLabelFor(order);
  return presentStatus({ status, reason: null, linkedApproval: false }).label;
}

function pathFrom(start: OrderStatus, target: OrderStatus): OrderStatus[] {
  if (start === target) return [start];
  const previous = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = [start];
  const seen = new Set<OrderStatus>([start]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of ORDER_TRANSITIONS[current]) {
      if (seen.has(next) || !isLegalOrderTransition(current, next)) continue;
      previous.set(next, current);
      if (next === target) return rebuild(previous, start, target);
      seen.add(next);
      queue.push(next);
    }
  }
  return [start];
}

function rebuild(previous: Map<OrderStatus, OrderStatus>, start: OrderStatus, target: OrderStatus): OrderStatus[] {
  const path: OrderStatus[] = [target];
  let cursor = target;
  while (cursor !== start) {
    const prior = previous.get(cursor);
    if (!prior) break;
    path.push(prior);
    cursor = prior;
  }
  return path.reverse();
}

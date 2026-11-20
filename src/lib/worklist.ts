// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { DEMO_NOW } from "@/data/orders";
import { ownerRoleFor, STATUSES, isClosed, type OwnerRole } from "@/domain/statuses";
import { computeTimeRisk, type TimeRisk } from "@/domain/timeRisk";
import type { Order } from "@/domain/types";
import { minutesSince } from "./format";

export interface Row {
  order: Order;
  ownerRole: OwnerRole;
  risk: TimeRisk;
  minutesInStatus: number;
  overSla: boolean;
  closed: boolean;
}

export function toRow(order: Order, now: Date = DEMO_NOW): Row {
  const def = STATUSES[order.status];
  const minutesInStatus = minutesSince(order.statusSince, now);
  return {
    order,
    ownerRole: ownerRoleFor(order.status, order.channel),
    risk: computeTimeRisk({
      scanAt: order.scheduledAt ? new Date(order.scheduledAt) : null,
      insurer: order.insurer,
      status: order.status,
      now,
    }),
    minutesInStatus,
    overSla: def.slaHours !== null && minutesInStatus > def.slaHours * 60,
    closed: isClosed(order.status),
  };
}

export type ViewId = "open" | "coordinator" | "nurse" | "automated" | "closed";

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "open", label: "All open", hint: "Every order still in flight" },
  { id: "coordinator", label: "Coordinator queue", hint: "Paperwork that needs chasing" },
  { id: "nurse", label: "Nurse queue", hint: "Clinical gaps, rule gaps and denials" },
  { id: "automated", label: "Automated", hint: "The pipeline has it; no one needs to act" },
  { id: "closed", label: "Closed", hint: "Approved, not required, cancelled" },
];

export function inView(row: Row, view: ViewId): boolean {
  switch (view) {
    case "open":
      return !row.closed;
    case "coordinator":
      return !row.closed && row.ownerRole === "coordinator";
    case "nurse":
      return !row.closed && (row.ownerRole === "nurse" || row.ownerRole === "rules_admin");
    case "automated":
      return !row.closed && row.ownerRole === "system";
    case "closed":
      return row.closed;
  }
}

/** True when a human has to act and nobody has claimed it yet. */
export function needsAssignee(row: Row): boolean {
  return !row.closed && row.ownerRole !== "system" && row.order.assigneeId === null;
}

export function needsPerson(row: Row): boolean {
  return !row.closed && row.ownerRole !== "system";
}

export type QuickFilter = "needs_person" | "unassigned" | "slot_at_risk" | "no_touch";

export const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "needs_person", label: "Needs a person" },
  { id: "unassigned", label: "Unassigned" },
  { id: "slot_at_risk", label: "Slot at risk" },
  { id: "no_touch", label: "Ready, no touch" },
];

export function matchesQuick(row: Row, f: QuickFilter): boolean {
  switch (f) {
    case "needs_person":
      return needsPerson(row);
    case "unassigned":
      return needsAssignee(row);
    case "slot_at_risk":
      return row.risk === "slot_at_risk";
    case "no_touch":
      return !row.closed && row.ownerRole === "system" && row.order.status === "ready_to_submit";
  }
}

export function matchesSearch(row: Row, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const o = row.order;
  return [o.patient?.name, o.patient?.mrn, o.orderNumber, o.cpt, o.study, o.insurer, o.reason]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(needle));
}

/** Default sort: scan date, earliest first. Orders with no scan date go last. Never arrival order. */
export function bySchedule(a: Row, b: Row): number {
  const at = a.order.scheduledAt ? new Date(a.order.scheduledAt).getTime() : Infinity;
  const bt = b.order.scheduledAt ? new Date(b.order.scheduledAt).getTime() : Infinity;
  return at - bt;
}

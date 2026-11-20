// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { DEMO_NOW } from "@/data/orders";
import { deriveFlags, type Flag } from "@/domain/flags";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { inSavedView, SAVED_VIEWS, type SavedView } from "@/domain/priorAuth/render";
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
  flags: Flag[];
}

export function toRow(order: Order, now: Date = DEMO_NOW): Row {
  const def = STATUSES[order.status];
  const minutesInStatus = minutesSince(order.statusSince, now);
  const scanAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const risk = computeTimeRisk({ scanAt, insurer: order.insurer, status: order.status, now });
  const overSla = def.slaHours !== null && minutesInStatus > def.slaHours * 60;
  const closed = isClosed(order.status);

  return {
    order,
    ownerRole: ownerRoleFor(order.status, order.channel),
    risk,
    minutesInStatus,
    overSla,
    closed,
    flags: deriveFlags({
      findings: order.findings ?? [],
      risk,
      priority: order.priority,
      closed,
      overSla:
        overSla && def.slaHours !== null
          ? { statusLabel: def.label, minutes: minutesInStatus, slaHours: def.slaHours }
          : null,
      scanAt,
      insurer: order.insurer,
      now,
    }),
  };
}

/** Saved views (tabs). Each one is a filter over rows; counts come from the same predicate. */
export type ViewId = SavedView;

export const VIEWS: { id: ViewId; label: string; hint: string }[] = SAVED_VIEWS;

export function inView(row: Row, view: ViewId, now: Date = DEMO_NOW): boolean {
  return inSavedView({
    status: toOrderStatus(row.order.status),
    channel: row.order.channel,
    statusSince: new Date(row.order.statusSince),
    view,
    now,
  });
}

/** True when a human has to act and nobody has claimed it yet. */
export function needsAssignee(row: Row): boolean {
  return !row.closed && row.ownerRole !== "system" && row.order.assigneeId === null;
}

export function needsPerson(row: Row): boolean {
  return !row.closed && row.ownerRole !== "system";
}

export type QuickFilter = "needs_person" | "unassigned" | "slot_at_risk" | "no_touch";

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

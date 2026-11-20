// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { DEMO_NOW } from "@/data/orders";
import { deriveFlags, type Flag } from "@/domain/flags";
import { decisionScanAtRisk } from "@/domain/insurer/schedule";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { inSavedView, isWaitingOnDocuments, SAVED_VIEWS, type SavedView } from "@/domain/priorAuth/render";
import { reasonChip, stepProgress } from "@/domain/priorAuth/reasons";
import { ownerRoleFor, STATUSES, isClosed, type OwnerRole } from "@/domain/statuses";
import { computeTimeRisk, type TimeRisk } from "@/domain/timeRisk";
import type { Order } from "@/domain/types";
import { fmtDob, minutesSince } from "./format";

export interface Row {
  order: Order;
  ownerRole: OwnerRole;
  risk: TimeRisk;
  minutesInStatus: number;
  overSla: boolean;
  closed: boolean;
  flags: Flag[];
  /** Missing-document row whose follow-up has not come due. Still in the admin queue. */
  waiting: boolean;
  reasonChip: string | null;
  stepText: string | null;
}

export function toRow(order: Order, now: Date = DEMO_NOW): Row {
  const def = STATUSES[order.status];
  const minutesInStatus = minutesSince(order.statusSince, now);
  const scanAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const risk = computeTimeRisk({ scanAt, insurer: order.insurer, status: order.status, now });
  const processingStuck = order.status === "processing" && minutesInStatus > 15;
  const closed = isClosed(order.status);
  const waiting = isWaitingOnDocuments(order.reasonCode, order.followUpDueAt, now);
  const overSla = !waiting && (processingStuck || (def.slaHours !== null && order.status !== "processing" && minutesInStatus > def.slaHours * 60));

  return {
    order,
    ownerRole: ownerRoleFor(order.status, order.channel),
    risk,
    minutesInStatus,
    overSla,
    closed,
    waiting,
    reasonChip: order.reasonCode ? reasonChip(order.reasonCode) : null,
    stepText: order.status === "processing" && order.step ? stepProgress(order.step, order.detail) : null,
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
      scanDecisionRisk: decisionScanAtRisk(order.status, scanAt, now),
    }),
  };
}

/** Saved views (tabs). Each one is a filter over rows; counts come from the same predicate. */
export type ViewId = SavedView;

export const VIEWS: { id: ViewId; label: string; hint: string }[] = SAVED_VIEWS;

export function inView(row: Row, view: ViewId, _now: Date = DEMO_NOW): boolean {
  return inSavedView({ status: toOrderStatus(row.order.status), view });
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
      return !row.closed && row.ownerRole === "system" && (row.order.status === "processing" || row.order.status === "submitted");
  }
}

export function matchesSearch(row: Row, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const o = row.order;
  const dob = o.patient ? fmtDob(o.patient.dob) : "";
  return [o.patient?.name, o.patient?.mrn, o.patient?.dob, dob, o.orderNumber, o.cpt, o.study, o.insurer, o.plan, o.reason]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(needle));
}

/** Scan date ascending, then longest time in status first. Orders with no scan date go last. */
export function bySchedule(a: Row, b: Row): number {
  const at = a.order.scheduledAt ? new Date(a.order.scheduledAt).getTime() : Infinity;
  const bt = b.order.scheduledAt ? new Date(b.order.scheduledAt).getTime() : Infinity;
  if (at !== bt) return at - bt;
  return b.minutesInStatus - a.minutesInStatus;
}

// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { DEMO_NOW } from "@/data/orders";
import { deriveFlags, type Flag } from "@/domain/flags";
import { decisionScanAtRisk } from "@/domain/insurer/schedule";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { inSavedView, isWaitingOnDocuments } from "@/domain/priorAuth/render";
import { reasonChip, stepProgress } from "@/domain/priorAuth/reasons";
import { ownerRoleFor, STATUSES, isClosed, type OwnerRole } from "@/domain/statuses";
import { computeTimeRisk, isSubmitAtRisk, type TimeRisk } from "@/domain/timeRisk";
import type { Order, Person } from "@/domain/types";
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
  /** Submit-by has passed, or open blockers sit inside 48 hours of it. */
  atRisk: boolean;
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
    atRisk: isSubmitAtRisk({ scanAt, insurer: order.insurer, status: order.status, now }),
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
export type ViewId = "needs_me" | "admin" | "clinical" | "return_to_provider" | "in_flight" | "with_insurer" | "closed" | "all";

export interface Viewer {
  id: string;
  role: Person["role"];
}

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "needs_me", label: "Needs me", hint: "Yours, or unclaimed in your queue" },
  { id: "admin", label: "Coordinator", hint: "Paperwork, portal uploads and insurer requests" },
  { id: "clinical", label: "Nurse", hint: "Criteria, rule gaps and denials" },
  { id: "return_to_provider", label: "Return to provider", hint: "Criteria the ordering doctor has to change" },
  { id: "in_flight", label: "In flight", hint: "AI processing or a submit still running" },
  { id: "with_insurer", label: "With insurer", hint: "Submitted, waiting on a decision" },
  { id: "closed", label: "Closed", hint: "Approved, not required, denied or cancelled" },
  { id: "all", label: "All", hint: "Every order" },
];

/** Queues that split every case exactly once. Needs me and All cut across them. */
export const PARTITION_VIEWS: ViewId[] = ["admin", "clinical", "return_to_provider", "in_flight", "with_insurer", "closed"];

export function inView(row: Row, view: ViewId, _now: Date = DEMO_NOW, viewer?: Viewer): boolean {
  switch (view) {
    case "needs_me": {
      if (!viewer || row.closed || row.ownerRole === "system") return false;
      if (row.order.assigneeId) return row.order.assigneeId === viewer.id;
      return viewer.role === "coordinator" ? row.ownerRole === "coordinator" : row.ownerRole === "nurse";
    }
    case "admin":
      return inSavedView({ status: toOrderStatus(row.order.status), reason: row.order.reasonCode, step: row.order.step, view: "admin" }) && row.order.reasonCode !== "RETURN_TO_PROVIDER";
    case "clinical":
    case "in_flight":
    case "with_insurer":
    case "closed":
      return inSavedView({ status: toOrderStatus(row.order.status), reason: row.order.reasonCode, step: row.order.step, view });
    case "return_to_provider":
      return row.order.reasonCode === "RETURN_TO_PROVIDER";
    case "all":
      return true;
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

/** Saved "Slot at risk" filter. Stronger than a scan that is merely approaching. */
export function isSlotAtRisk(row: Row): boolean {
  return row.atRisk || row.risk === "slot_at_risk";
}

/** Scan-column state from submit-by. Empty when there is no slot. */
export function scanAttention(row: Row): "" | "At risk" | "On track" {
  if (!row.order.scheduledAt || row.closed) return "";
  return row.atRisk ? "At risk" : "On track";
}

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

/** True when the order was checked against this insurer policy id ("RAD-114", "RAD-114 v3"). */
export function matchesPolicy(ref: string | null, policyId: string): boolean {
  if (!policyId) return true;
  if (!ref) return false;
  return ref === policyId || ref.startsWith(`${policyId} `);
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

/** At-risk scans first, then scan time ascending. Rows with no slot stay at the bottom. */
export function byRiskThenScan(a: Row, b: Row): number {
  const diff = scanRank(a) - scanRank(b);
  if (diff !== 0) return diff;
  return bySchedule(a, b);
}

function scanRank(row: Row): number {
  if (!row.order.scheduledAt) return 2;
  if (row.atRisk || row.risk === "slot_at_risk" || row.risk === "at_risk") return 0;
  return 1;
}

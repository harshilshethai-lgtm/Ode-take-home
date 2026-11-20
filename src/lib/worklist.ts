// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { QUEUE_TARGET_HOURS, type QueueOwner } from "@/data/operations/queue";
import { DEMO_NOW } from "@/data/orders";
import { deriveFlags, type Flag } from "@/domain/flags";
import { configFor } from "@/domain/insurer/config";
import { decisionScanAtRisk } from "@/domain/insurer/schedule";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { inSavedView, isWaitingOnDocuments } from "@/domain/priorAuth/render";
import { guidanceFor, isSlotUnreachable } from "@/domain/guidance";
import { reasonChip, stepProgress } from "@/domain/priorAuth/reasons";
import { ownerRoleFor, STATUSES, isClosed, type OwnerRole } from "@/domain/statuses";
import { computeTimeRisk, isSubmitAtRisk, submitByAt, type TimeRisk } from "@/domain/timeRisk";
import type { Order, Person } from "@/domain/types";
import { parseDemoInstant } from "./demoClock";
import { fmtDob, fmtScanTight, minutesSince } from "./format";

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
  /** Latest moment to submit so the insurer can still answer before the scan. */
  submitBy: Date | null;
  /** Submit-by is already behind the demo clock. Closed rows are never past due. */
  pastDue: boolean;
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
  const submitBy = scanAt ? submitByAt(scanAt, order.insurer) : null;
  const pastDue = !closed && submitBy != null && now.getTime() > submitBy.getTime();
  const slotUnreachable = isSlotUnreachable(order);

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
    submitBy,
    pastDue,
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
      slotUnreachable,
    }),
  };
}

/** Saved views (tabs). Each one is a filter over rows; counts come from the same predicate. */
export type ViewId = "needs_me" | "at_risk" | "admin" | "clinical" | "return_to_provider" | "in_flight" | "with_insurer" | "closed" | "all";

export interface Viewer {
  id: string;
  role: Person["role"];
}

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "needs_me", label: "Needs me", hint: "Yours, or unclaimed in your queue" },
  { id: "at_risk", label: "At risk", hint: "Past due, or the slot is inside the insurer's turnaround" },
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
    case "at_risk":
      return isAtRisk(row);
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

/** Past due, submit-by inside the blocker window, or the slot is inside the insurer's turnaround. */
export function isAtRisk(row: Row): boolean {
  if (row.closed) return false;
  return row.pastDue || row.atRisk || row.risk === "at_risk" || row.risk === "slot_at_risk";
}

export function isSlotAtRisk(row: Row): boolean {
  return isAtRisk(row);
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

/** Past due, then at risk, then submit-by ascending. Rows with no slot stay at the bottom. */
export function byDue(a: Row, b: Row): number {
  const rank = dueRank(a) - dueRank(b);
  if (rank !== 0) return rank;
  const at = a.submitBy?.getTime() ?? Infinity;
  const bt = b.submitBy?.getTime() ?? Infinity;
  if (at !== bt) return at - bt;
  return b.minutesInStatus - a.minutesInStatus;
}

function dueRank(row: Row): number {
  if (!row.submitBy) return 3;
  if (row.pastDue) return 0;
  if (!row.closed && (row.atRisk || row.risk === "at_risk" || row.risk === "slot_at_risk")) return 1;
  return 2;
}

/** "31h", "6h", "40m", "2d". Hours until two days, then days. */
export function compactAge(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export interface DuePrimary {
  text: string;
  past: boolean;
}

/** Submit-by countdown. "in 6h", "Past due 5h", or "No slot". */
export function duePrimary(row: Row, now: Date = DEMO_NOW): DuePrimary {
  if (!row.submitBy || row.closed) return { text: row.order.scheduledAt && row.closed ? "Done" : "No slot", past: false };
  const mins = Math.round((row.submitBy.getTime() - now.getTime()) / 60000);
  const body = compactAge(Math.abs(mins));
  if (mins < 0) return { text: `Past due ${body}`, past: true };
  return { text: `in ${body}`, past: false };
}

/** Second line under the countdown. "scan Thu 11/12 9:00 AM". */
export function scanCaption(row: Row): string | null {
  if (!row.order.scheduledAt) return null;
  return `scan ${fmtScanTight(parseDemoInstant(row.order.scheduledAt))}`;
}

export interface NextStep {
  text: string;
  /** Full reason. Shown in the tooltip, never in the cell. */
  tip: string;
}

/** One verb-led line from the deadline and the top blocker. Same text as the case page. */
export function nextStep(row: Row): NextStep {
  const guide = guidanceFor(row.order);
  return { text: guide.nextStep, tip: guide.reason || guide.nextStep };
}

export interface QueueMeter {
  text: string;
  over: boolean;
}

/** Elapsed time in this queue against the Operations target. "5h / 4h". */
export function queueMeter(row: Row): QueueMeter {
  const elapsed = compactAge(row.minutesInStatus);
  const target = queueTargetHours(row);
  if (target == null) return { text: elapsed, over: false };
  const targetMins = target * 60;
  const targetLabel = Number.isInteger(target) ? `${target}h` : compactAge(targetMins);
  return { text: `${elapsed} / ${targetLabel}`, over: row.minutesInStatus > targetMins };
}

function queueTargetHours(row: Row): number | null {
  if (row.closed) return null;
  const owner = queueOwnerOf(row);
  return owner ? QUEUE_TARGET_HOURS[owner] : null;
}

function queueOwnerOf(row: Row): QueueOwner | null {
  if (row.order.status === "submitted") return "insurer";
  if (row.order.status === "processing") return "ai";
  if (row.ownerRole === "coordinator") return "coordinator";
  if (row.ownerRole === "nurse") return "nurse";
  return null;
}

export function studyLine(order: Order): string {
  const side = order.side === "Left" ? "L" : order.side === "Right" ? "R" : null;
  return [order.study, side, order.cpt].filter(Boolean).join(" · ");
}

export interface InsurerColumns {
  reference: string | null;
  waiting: string;
  lastCheck: string | null;
  overdue: boolean;
  latest: string;
}

/** With-insurer columns. Last check is overdue once the payer's cadence has passed. */
export function insurerColumns(row: Row, now: Date = DEMO_NOW): InsurerColumns {
  const detail = row.order.detail;
  const text = (key: string) => {
    const value = detail[key];
    return value == null ? "" : String(value).trim();
  };
  const last = spokenInstant(text("date"), text("time"));
  const cadence = checkCadenceHours(row.order.insurer);
  const overdue = last != null && now.getTime() - last.getTime() > cadence * 36e5;
  return {
    reference: text("ref") || null,
    waiting: compactAge(row.minutesInStatus),
    lastCheck: last ? compactAge(Math.abs(now.getTime() - last.getTime()) / 60000) + (last.getTime() <= now.getTime() ? " ago" : "") : text("time") || null,
    overdue,
    latest: latestAnswer(row, text("normalized")),
  };
}

function latestAnswer(row: Row, normalized: string): string {
  if (normalized) return normalized;
  switch (row.order.reasonCode) {
    case "PENDED_BY_INSURER":
      return "Pended";
    case "APPEAL":
      return "Appeal sent";
    case "AWAITING_DECISION":
      return "In review";
    default:
      return "Awaiting decision";
  }
}

function checkCadenceHours(insurer: string | null): number {
  if (!insurer) return 4;
  try {
    return configFor(insurer).statusEveryHours;
  } catch {
    return 4;
  }
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "Nov 9" + "3:45 PM" in the demo year, as an America/New_York instant. */
function spokenInstant(date: string, time: string): Date | null {
  const day = /([A-Za-z]+)\s+(\d{1,2})/.exec(date);
  const clock = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  if (!day || !clock) return null;
  const month = MONTH_INDEX[day[1].slice(0, 3).toLowerCase()];
  if (month == null) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const ap = clock[3].toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return parseDemoInstant(`2026-${pad(month + 1)}-${pad(Number(day[2]))}T${pad(hour)}:${pad(minute)}:00`);
}

export interface ClosedColumns {
  outcome: string;
  auth: string | null;
  validThrough: string | null;
}

export function closedColumns(order: Order): ClosedColumns {
  const number = order.detail.number;
  const validTo = order.detail.validTo;
  return {
    outcome: STATUSES[order.status].label,
    auth: number == null || number === "" ? null : String(number),
    validThrough: validTo == null || validTo === "" ? null : String(validTo),
  };
}

export interface CriteriaScore {
  met: number;
  total: number;
}

export function criteriaScore(rows: Array<{ status: string }>): CriteriaScore | null {
  if (rows.length === 0) return null;
  const met = rows.filter((row) => row.status === "met" || row.status === "waived").length;
  return { met, total: rows.length };
}

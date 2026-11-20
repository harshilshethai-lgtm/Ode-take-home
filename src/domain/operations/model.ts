import { DEMO_NOW } from "@/data/orders";
import { demoDateKey } from "@/lib/demoClock";
import { METRICS, OPS_METRICS, type Direction, type MetricSpec } from "@/data/impact/metrics";
import {
  DONE_PARTS,
  HOSPITAL,
  OWNERS,
  REASON_ORDER,
  autonomyFor,
  queueOwner,
  type Autonomy,
  type QueueOwner,
} from "@/data/operations/queue";
import { MATCHED_BASELINE, THROUGHPUT, type ThroughputCase } from "@/data/operations/throughput";
import { INSURER_TURNAROUND_HOURS } from "@/domain/timeRisk";
import { isClosed, STATUSES, type StatusId } from "@/domain/statuses";
import type { Order } from "@/domain/types";
import { reasonChip } from "@/domain/priorAuth/reasons";
import type { ReasonCode } from "@/domain/priorAuth/types";
import { isWaitingOnDocuments } from "@/domain/priorAuth/render";
import { computeTimeRisk } from "@/domain/timeRisk";
import { ageBucket, businessHoursBetween, addBusinessHours, fmtBusiness } from "@/domain/operations/time";

export type Period = "today" | "week";

export interface OperationsScope {
  hospital: string | null;
  insurer: string | null;
  period: Period;
}

const NOW = DEMO_NOW;
const UPDATED_AT = new Date(NOW.getTime() - 2 * 60 * 1000);
const TURNAROUND_DEFAULT = 48;

export function updatedLabel(now: Date = NOW): string {
  const mins = Math.round((now.getTime() - UPDATED_AT.getTime()) / 60000);
  return `Updated ${mins} min ago`;
}

export function scopeOptions(orders: Order[]): { hospitals: string[]; insurers: string[] } {
  const insurers = new Set<string>(Object.keys(MATCHED_BASELINE));
  for (const order of orders) if (order.insurer) insurers.add(order.insurer);
  return { hospitals: [HOSPITAL], insurers: [...insurers].sort() };
}

function sameDay(a: Date, b: Date): boolean {
  return demoDateKey(a) === demoDateKey(b);
}

function orderInScope(order: Order, scope: OperationsScope): boolean {
  if (scope.hospital && scope.hospital !== HOSPITAL) return false;
  if (scope.insurer && order.insurer !== scope.insurer) return false;
  return true;
}

function caseInScope(row: ThroughputCase, scope: OperationsScope): boolean {
  if (scope.hospital && row.hospital !== scope.hospital) return false;
  if (scope.insurer && row.insurer !== scope.insurer) return false;
  return true;
}

function inPeriod(row: ThroughputCase, period: Period): boolean {
  if (period === "today") return sameDay(row.orderedAt, NOW);
  return row.weekIndex === 7;
}

function submitted(row: ThroughputCase, now: Date): boolean {
  return row.submittedAt.getTime() <= now.getTime();
}

function decided(row: ThroughputCase, now: Date): boolean {
  return row.decidedAt.getTime() <= now.getTime();
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function noNurseRate(rows: ThroughputCase[], now: Date): number | null {
  const done = rows.filter((row) => submitted(row, now));
  if (done.length === 0) return null;
  return done.filter((row) => !row.nurseTouched).length / done.length;
}

function medianSubmit(rows: ThroughputCase[], now: Date): number | null {
  return median(
    rows.filter((row) => submitted(row, now)).map((row) => businessHoursBetween(row.orderedAt, row.submittedAt)),
  );
}

function intakeRate(rows: ThroughputCase[]): number | null {
  let items = 0;
  let caught = 0;
  for (const row of rows) {
    items += row.missingItems;
    caught += row.caughtAtIntake;
  }
  return items === 0 ? null : caught / items;
}

function spotRate(rows: ThroughputCase[], now: Date): number | null {
  const checked = rows.filter((row) => row.spot && submitted(row, now));
  if (checked.length === 0) return null;
  return checked.filter((row) => row.spot === "agree").length / checked.length;
}

function overturnRate(rows: ThroughputCase[], now: Date): number | null {
  const ready = rows.filter((row) => !row.nurseTouched && submitted(row, now) && decided(row, now));
  if (ready.length === 0) return null;
  return ready.filter((row) => row.overturned).length / ready.length;
}

function denialRate(rows: ThroughputCase[], now: Date): number | null {
  const ready = rows.filter((row) => !row.nurseTouched && submitted(row, now) && decided(row, now));
  if (ready.length === 0) return null;
  return ready.filter((row) => row.aiReadyDenied).length / ready.length;
}

function decisionHours(rows: ThroughputCase[], now: Date): number | null {
  return median(
    rows
      .filter((row) => decided(row, now))
      .map((row) => (row.decidedAt.getTime() - row.submittedAt.getTime()) / 36e5),
  );
}

const READERS: { metric: MetricSpec; read: (rows: ThroughputCase[], now: Date) => number | null }[] = [
  { metric: OPS_METRICS.no_nurse_submit, read: noNurseRate },
  { metric: OPS_METRICS.order_to_submit, read: medianSubmit },
  { metric: OPS_METRICS.intake_catch, read: (rows) => intakeRate(rows) },
  { metric: METRICS.spot_check, read: spotRate },
  { metric: OPS_METRICS.overturned, read: overturnRate },
];

export function trackTone(direction: Direction, value: number, target: number): "ready" | "hold" | "blocked" {
  const met = direction === "higher" ? value >= target - 1e-9 : value <= target + 1e-9;
  if (met) return "ready";
  if (target === 0) return "blocked";
  return Math.abs(value - target) / Math.abs(target) <= 0.1 + 1e-9 ? "hold" : "blocked";
}

export interface ScoreTile {
  metric: MetricSpec;
  value: number | null;
  series: (number | null)[];
}

export interface QueueRowModel {
  id: QueueOwner;
  name: string;
  definition: string;
  count: number;
  buckets: [number, number, number];
  oldestHours: number | null;
  pastDue: number;
  reasons: { label: string; count: number }[];
}

export interface AttentionItem {
  orderId: string;
  dueAt: Date | null;
  dueText: string;
  slotAtRisk: boolean;
  pastDue: boolean;
  slotText: string;
  patient: string;
  scan: string;
  insurer: string;
  owner: string;
  why: string;
}

export interface InsurerRowModel {
  insurer: string;
  autonomy: Autonomy;
  requests: number;
  noNurse: number | null;
  decisionHours: number | null;
  aiReadyDenial: number | null;
  matchedBaseline: number | null;
  open: number;
}

export interface DonePart {
  label: string;
  count: number;
}

export interface OperationsModel {
  updated: string;
  tiles: ScoreTile[];
  queue: QueueRowModel[];
  scale: number;
  doneToday: DonePart[];
  attention: AttentionItem[];
  byInsurer: InsurerRowModel[];
}

export function taskDue(order: Order): Date | null {
  const sla = STATUSES[order.status].slaHours;
  if (sla == null) return null;
  return addBusinessHours(new Date(order.statusSince), sla);
}

export function latestSubmitAt(order: Order): Date | null {
  if (isClosed(order.status)) return null;
  const turnaround = (order.insurer && INSURER_TURNAROUND_HOURS[order.insurer]) || TURNAROUND_DEFAULT;
  if (order.status === "submitted") {
    return new Date(new Date(order.statusSince).getTime() + turnaround * 36e5);
  }
  if (!order.scheduledAt) return null;
  return new Date(new Date(order.scheduledAt).getTime() - turnaround * 36e5);
}

export function earliestDue(order: Order): Date | null {
  const times = [taskDue(order), latestSubmitAt(order)].filter((time): time is Date => time != null);
  if (times.length === 0) return null;
  return times.sort((a, b) => a.getTime() - b.getTime())[0];
}

export function isPastDue(order: Order, now: Date = NOW): boolean {
  if (isClosed(order.status)) return false;
  const submitBy = latestSubmitAt(order);
  if (submitBy && now.getTime() > submitBy.getTime()) return true;
  if (isWaitingOnDocuments(order.reasonCode, order.followUpDueAt, now)) return false;
  const task = taskDue(order);
  if (task && now.getTime() > task.getTime()) return true;
  return false;
}

export function isSlotAtRisk(order: Order, now: Date = NOW): boolean {
  if (isClosed(order.status)) return false;
  const scanAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  return computeTimeRisk({ scanAt, insurer: order.insurer, status: order.status, now }) === "slot_at_risk";
}

function dueText(deadline: Date | null, now: Date): string {
  if (!deadline) return "—";
  if (deadline.getTime() === now.getTime()) return "now";
  const past = deadline.getTime() < now.getTime();
  const hours = businessHoursBetween(past ? deadline : now, past ? now : deadline);
  const body = fmtBusiness(hours);
  if (body === "0m") return "now";
  return past ? `Past due by ${body}` : `in ${body}`;
}

function ownerName(status: StatusId, autonomy: Autonomy): string {
  const owner = queueOwner(status, autonomy);
  if (owner === "done") return "Done";
  return OWNERS.find((row) => row.id === owner)?.name ?? "Done";
}

export function attentionItems(orders: Order[], scope: OperationsScope, now: Date = NOW): AttentionItem[] {
  return orders
    .filter((order) => orderInScope(order, scope))
    .map((order) => {
      const autonomy = autonomyFor(order.insurer, order.channel);
      const dueAt = earliestDue(order);
      return {
        orderId: order.id,
        dueAt,
        dueText: dueText(dueAt, now),
        slotAtRisk: isSlotAtRisk(order, now),
        pastDue: isPastDue(order, now),
        slotText: order.scheduledAt ? order.scheduledAt : "",
        patient: order.patient?.name ?? "Unmatched",
        scan: order.study,
        insurer: order.insurer ?? "—",
        owner: ownerName(order.status, autonomy),
        why: order.reason,
      };
    })
    .filter((row) => row.slotAtRisk || row.pastDue)
    .sort((a, b) => {
      if (a.slotAtRisk !== b.slotAtRisk) return a.slotAtRisk ? -1 : 1;
      const at = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return at - bt;
    })
    .slice(0, 10);
}

function queueRows(orders: Order[], scope: OperationsScope, now: Date): QueueRowModel[] {
  const open = orders.filter((order) => orderInScope(order, scope) && !isClosed(order.status));
  return OWNERS.map((owner) => {
    const rows = open.filter((order) => queueOwner(order.status, autonomyFor(order.insurer, order.channel)) === owner.id);
    const buckets: [number, number, number] = [0, 0, 0];
    let oldest: number | null = null;
    let pastDue = 0;
    const reasonCounts = new Map<ReasonCode, number>();
    for (const order of rows) {
      const age = businessHoursBetween(new Date(order.statusSince), now);
      buckets[ageBucket(age)] += 1;
      oldest = oldest == null ? age : Math.max(oldest, age);
      if (isPastDue(order, now)) pastDue += 1;
      if (order.reasonCode) reasonCounts.set(order.reasonCode, (reasonCounts.get(order.reasonCode) ?? 0) + 1);
    }
    const chipOrder = new Map(REASON_ORDER.map((code, index) => [reasonChip(code), index]));
    const byChip = new Map<string, number>();
    for (const [code, count] of reasonCounts) {
      const chip = reasonChip(code);
      byChip.set(chip, (byChip.get(chip) ?? 0) + count);
    }
    const reasons = [...byChip.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (chipOrder.get(a.label) ?? 99) - (chipOrder.get(b.label) ?? 99) || b.count - a.count);
    return {
      id: owner.id,
      name: owner.name,
      definition: owner.definition,
      count: rows.length,
      buckets,
      oldestHours: oldest,
      pastDue,
      reasons,
    };
  });
}

function doneToday(orders: Order[], scope: OperationsScope, now: Date): DonePart[] {
  const today = orders.filter((order) => orderInScope(order, scope) && sameDay(new Date(order.statusSince), now));
  return DONE_PARTS.map((part) => ({
    label: part.label,
    count: today.filter((order) => part.statuses.includes(order.status)).length,
  })).filter((part) => part.count > 0);
}

function insurerRows(orders: Order[], rows: ThroughputCase[], scope: OperationsScope, now: Date): InsurerRowModel[] {
  const names = new Set<string>(Object.keys(MATCHED_BASELINE));
  for (const order of orders) if (order.insurer) names.add(order.insurer);
  const list = scope.insurer ? [scope.insurer] : [...names];
  return list
    .map((insurer) => {
      const mine = rows.filter((row) => row.insurer === insurer);
      const open = orders.filter(
        (order) =>
          order.insurer === insurer &&
          orderInScope(order, { ...scope, insurer: null }) &&
          !isClosed(order.status) &&
          queueOwner(order.status, autonomyFor(order.insurer, order.channel)) === "insurer",
      ).length;
      const sample = orders.find((order) => order.insurer === insurer);
      return {
        insurer,
        autonomy: autonomyFor(insurer, sample?.channel ?? null),
        requests: mine.length,
        noNurse: noNurseRate(mine, now),
        decisionHours: decisionHours(mine, now),
        aiReadyDenial: denialRate(mine, now),
        matchedBaseline: MATCHED_BASELINE[insurer] ?? null,
        open,
      };
    })
    .sort((a, b) => b.requests - a.requests || a.insurer.localeCompare(b.insurer));
}

export function buildOperations(orders: Order[], scope: OperationsScope, now: Date = NOW): OperationsModel {
  const scoped = THROUGHPUT.filter((row) => caseInScope(row, scope));
  const periodRows = scoped.filter((row) => inPeriod(row, scope.period));
  const tiles: ScoreTile[] = READERS.map((reader) => ({
    metric: reader.metric,
    value: reader.read(periodRows, now),
    series: Array.from({ length: 8 }, (_, week) => reader.read(scoped.filter((row) => row.weekIndex === week), now)),
  }));
  const queue = queueRows(orders, scope, now);
  return {
    updated: updatedLabel(now),
    tiles,
    queue,
    scale: Math.max(1, ...queue.map((row) => row.count)),
    doneToday: doneToday(orders, scope, now),
    attention: attentionItems(orders, scope, now),
    byInsurer: insurerRows(orders, periodRows, scope, now),
  };
}

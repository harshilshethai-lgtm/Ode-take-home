// Pure view logic for the worklist: row derivation, saved views, filters, sorting.

import { DEMO_NOW } from "@/data/orders";
import { deriveFlags, type Flag } from "@/domain/flags";
import { ownerRoleFor, STATUSES, isClosed, type OwnerRole } from "@/domain/statuses";
import { computeTimeRisk, type TimeRisk } from "@/domain/timeRisk";
import type { Order, Person } from "@/domain/types";
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
export type ViewId = "mine" | "unassigned" | "slot_at_risk" | "nurse" | "automated" | "closed";

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "mine", label: "Needs me", hint: "Yours, plus unclaimed work for your role" },
  { id: "unassigned", label: "Unassigned", hint: "A person has to act and nobody has claimed it" },
  { id: "slot_at_risk", label: "Slot at risk", hint: "The insurer can't answer before the scan" },
  { id: "nurse", label: "Nurse", hint: "Clinical gaps, rule gaps and denials" },
  { id: "automated", label: "Automated", hint: "The pipeline has it" },
  { id: "closed", label: "Closed", hint: "Approved, not required, cancelled" },
];

export function inView(row: Row, view: ViewId, me: { id: string; role: Person["role"] }): boolean {
  switch (view) {
    case "mine": {
      if (!needsPerson(row)) return false;
      if (row.order.assigneeId === me.id) return true;
      const myOwnerRoles: OwnerRole[] = me.role === "coordinator" ? ["coordinator"] : ["nurse", "rules_admin"];
      return row.order.assigneeId === null && myOwnerRoles.includes(row.ownerRole);
    }
    case "unassigned":
      return needsAssignee(row);
    case "slot_at_risk":
      return !row.closed && row.risk === "slot_at_risk";
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

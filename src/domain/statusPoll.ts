// When a status check is already due, the case page runs it on load.
// The check writes one activity note and moves the latest answer forward.
// It does not transition the order onto the status it already has.

import { configFor } from "@/domain/insurer/config";
import { nextStatusCheck } from "@/domain/insurer/schedule";
import type { InsurerTimelineRow } from "@/domain/insurer/view";
import { previewInsurerPanel } from "@/domain/insurer/view";
import type { ActivityEntry, Order } from "@/domain/types";
import { DEMO_NOW, nextCheckLabel, parseDemoInstant } from "@/lib/demoClock";
import { fmtCountdown as formatCountdown } from "@/lib/format";

export interface SettledCheck {
  /** True when nextCheck was already behind the clock, so the check ran. */
  ran: boolean;
  nextCheckLabel: string;
  nextCheckAt: string | null;
  latestLabel: string | null;
  lastCheckedLabel: string | null;
  activity: ActivityEntry | null;
  timeline: InsurerTimelineRow | null;
}

export function checkIsDue(order: Order, now: Date = DEMO_NOW): boolean {
  const at = dueAt(order);
  return at != null && at.getTime() < now.getTime();
}

/** Label for a scheduled check. A time behind the clock is Overdue, never "ago". */
export function checkLabel(at: Date, now: Date = DEMO_NOW): string {
  if (at.getTime() < now.getTime()) return "Overdue";
  const text = formatCountdown(at, now);
  return text.endsWith("ago") ? "Overdue" : text;
}

/**
 * Ask the insurer once. Latest answer moves forward and the next check is
 * scheduled from now. The activity note is not a status self-transition.
 */
export function runStatusCheck(order: Order, now: Date = DEMO_NOW): SettledCheck | null {
  const panel = previewInsurerPanel(order);
  if (!panel) return null;
  const insurer = order.insurer ?? "the insurer";
  let next = new Date(now.getTime() + 4 * 36e5);
  try {
    next = nextStatusCheck(configFor(insurer), now);
  } catch {
    /* keep the four-hour cadence */
  }
  const latest = panel.latestLabel === "In review" ? "Pended" : "In review";
  return {
    ran: true,
    nextCheckLabel: checkLabel(next, now),
    nextCheckAt: next.toISOString(),
    latestLabel: latest,
    lastCheckedLabel: "Just now",
    activity: {
      at: now.toISOString(),
      actor: "System",
      from: "",
      to: "",
      reason: `Checked ${insurer}. Latest answer: ${latest}.`,
    },
    timeline: {
      id: `${order.id}-poll`,
      kind: "status",
      time: "Just now",
      channel: panel.channelLabel,
      result: latest,
    },
  };
}

/** Run the check only when nextCheck is already behind the clock. */
export function settleDueCheck(order: Order, now: Date = DEMO_NOW): SettledCheck | null {
  const panel = previewInsurerPanel(order);
  if (!panel) return null;
  const at = panel.nextCheckAt ? parseDemoInstant(panel.nextCheckAt) : null;
  if (!at || at.getTime() >= now.getTime()) {
    return {
      ran: false,
      nextCheckLabel: at ? checkLabel(at, now) : (panel.nextCheckLabel ?? ""),
      nextCheckAt: panel.nextCheckAt,
      latestLabel: panel.latestLabel,
      lastCheckedLabel: panel.lastCheckedLabel,
      activity: null,
      timeline: null,
    };
  }
  return runStatusCheck(order, now);
}

function dueAt(order: Order): Date | null {
  const panel = previewInsurerPanel(order);
  if (!panel?.nextCheckAt) return null;
  return parseDemoInstant(panel.nextCheckAt);
}

export function displayedNextCheck(order: Order, now: Date = DEMO_NOW): string | null {
  const panel = previewInsurerPanel(order);
  if (!panel?.nextCheckAt) return null;
  return nextCheckLabel(panel.nextCheckAt, now);
}

// Time-risk policy from PRD §Other configurable modules:
// "At risk when the scan is inside the insurer's turnaround + 1 day."
// Slot at risk is the stronger state: the insurer cannot answer in time (or the 24h scan watch has fired).

import { isClosed, type StatusId } from "./statuses";

export type TimeRisk = "on_track" | "at_risk" | "slot_at_risk" | "none";

/** Typical insurer turnaround in hours. Configurable per insurer in the real product. */
export const INSURER_TURNAROUND_HOURS: Record<string, number> = {
  "Federation Health": 24,
  "Vulcan Mutual": 24,
  "Klingon Assurance": 48,
  "Bajoran Care": 24,
  "Ferengi Benefit Group": 72,
  "Andorian Life": 72,
};

const DEFAULT_TURNAROUND_HOURS = 48;
const SCAN_WATCH_HOURS = 24;

export function hoursUntil(scanAt: Date, now: Date): number {
  return (scanAt.getTime() - now.getTime()) / 36e5;
}

/**
 * When the fix has to be done so the order is still a day before it would turn at risk.
 * At risk starts at scan − (turnaround + 1 day). Fix-by is one day before that.
 * Ferengi (72h) and a Tue 11/17 2:00 PM scan land on Thu 11/12 2:00 PM.
 */
export function fixByAt(scanAt: Date, insurer: string | null): Date {
  const turnaround = (insurer && INSURER_TURNAROUND_HOURS[insurer]) || DEFAULT_TURNAROUND_HOURS;
  return new Date(scanAt.getTime() - (turnaround + 48) * 36e5);
}

export function computeTimeRisk(args: {
  scanAt: Date | null;
  insurer: string | null;
  status: StatusId;
  now: Date;
}): TimeRisk {
  const { scanAt, insurer, status, now } = args;
  if (!scanAt || isClosed(status)) return "none";

  const hours = hoursUntil(scanAt, now);
  const turnaround = (insurer && INSURER_TURNAROUND_HOURS[insurer]) || DEFAULT_TURNAROUND_HOURS;

  if (hours <= SCAN_WATCH_HOURS) return "slot_at_risk";
  // Not yet sent (or still pre-submit) and the insurer can't answer before the scan.
  const beforeSubmission = status !== "submitted";
  if (beforeSubmission && hours <= turnaround) return "slot_at_risk";
  if (hours <= turnaround + 24) return "at_risk";
  return "on_track";
}

export const TIME_RISK_LABEL: Record<TimeRisk, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slot_at_risk: "Slot at risk",
  none: "—",
};

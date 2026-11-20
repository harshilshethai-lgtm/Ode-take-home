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

/** US federal holidays for the demo year, including observed days. Deadlines do not land on these. */
const HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-07-04",
  "2026-09-07",
  "2026-10-12",
  "2026-11-11",
  "2026-11-26",
  "2026-12-25",
]);

function localKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function isBusinessDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(localKey(d));
}

/** Step backward so a deadline never falls on a weekend or holiday. */
function rollToBusinessDay(d: Date): Date {
  const next = new Date(d);
  while (!isBusinessDay(next)) next.setDate(next.getDate() - 1);
  return next;
}

/** Elapsed hours that fall on a business day, weekends and holidays excluded. */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  let ms = 0;
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const day = new Date(cursor);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const slice = Math.min(next, endMs);
    if (isBusinessDay(day)) ms += slice - cursor;
    cursor = slice;
  }
  return ms / 36e5;
}

/** The calendar date `days` business days before `day`. */
export function subtractBusinessDays(day: Date, days: number): Date {
  const cursor = new Date(day.getTime());
  let left = days;
  while (left > 0) {
    cursor.setDate(cursor.getDate() - 1);
    if (isBusinessDay(cursor)) left -= 1;
  }
  return cursor;
}

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
  return rollToBusinessDay(new Date(scanAt.getTime() - (turnaround + 48) * 36e5));
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

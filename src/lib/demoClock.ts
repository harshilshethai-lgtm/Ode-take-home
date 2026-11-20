// Halcyon's one demo clock. The hospital is in the Mid-Atlantic, so every
// naive timestamp in the seed is America/New_York wall time. Relative copy
// ("ago", "in", past due, at risk, next check) reads this instant, never Date.now().

import { fmtCountdown, fmtWeekdayDate } from "@/lib/format";

export const DEMO_TIME_ZONE = "America/New_York";

/** 2:00 PM on Tuesday, November 10, 2026, in America/New_York (EST, UTC−5). */
export const DEMO_NOW = parseDemoInstant("2026-11-10T14:00:00");

let stampOffsetMs = 0;

/** Put the audit sequence back on the epoch. The displayed clock does not drift. */
export function resetDemoClock(): void {
  stampOffsetMs = 0;
}

/**
 * A timestamp for an audit row. Each call is one second later so two edits in
 * the same session stay ordered, and reset snaps the sequence back to the epoch.
 */
export function nextDemoStamp(): string {
  stampOffsetMs += 1000;
  return new Date(DEMO_NOW.getTime() + stampOffsetMs).toISOString();
}

export function getDemoNow(): Date {
  return DEMO_NOW;
}

/** Calendar day of an instant in America/New_York, `YYYY-MM-DD`. */
export function demoDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Parse a seed timestamp. Strings with a zone are instants. Strings without one
 * are America/New_York wall time, which is how the packets are printed.
 */
export function parseDemoInstant(value: string): Date {
  const trimmed = value.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(trimmed)) return new Date(trimmed);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (!match) return new Date(trimmed);
  const wallUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  let utc = wallUtc;
  for (let i = 0; i < 3; i += 1) {
    const shown = wallClockUtc(new Date(utc));
    const delta = wallUtc - shown;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

function wallClockUtc(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/** "22h 15m ago" or "in 4h", measured from the demo clock. */
export function relativeToClock(value: string | Date, now: Date = DEMO_NOW): string {
  const at = typeof value === "string" ? parseDemoInstant(value) : value;
  return fmtCountdown(at, now);
}

/** Deadline copy. A time before the clock is past due; a later one is "Submit by Tue 11/10". */
export function formatFixBy(at: Date, now: Date = DEMO_NOW): string {
  const day = fmtWeekdayDate(at);
  return at.getTime() < now.getTime() ? `Past due · ${day}` : `Submit by ${day}`;
}

export const SUBMIT_BY_HINT = "Scan time minus the insurer's median decision time, minus 4 business hours.";

/** Next status check. A time the clock has passed is overdue, never "ago". */
export function nextCheckLabel(value: string, now: Date = DEMO_NOW): string {
  const at = parseDemoInstant(value);
  if (at.getTime() < now.getTime()) return "Overdue";
  return relativeToClock(at, now);
}

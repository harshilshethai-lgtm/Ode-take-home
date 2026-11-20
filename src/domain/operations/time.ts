/** Weekdays 8:00–17:00 America/New_York. Nights and weekends do not count. */

import { demoDateKey, parseDemoInstant } from "@/lib/demoClock";

const OPEN = 8;
const CLOSE = 17;

function dayOfWeek(date: Date): number {
  const key = demoDateKey(date);
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))).getUTCDay();
}

function isWeekday(date: Date): boolean {
  const day = dayOfWeek(date);
  return day !== 0 && day !== 6;
}

function atHour(date: Date, hour: number): Date {
  return parseDemoInstant(`${demoDateKey(date)}T${String(hour).padStart(2, "0")}:00:00`);
}

function nextMorning(date: Date): Date {
  const noon = parseDemoInstant(`${demoDateKey(date)}T12:00:00`);
  return atHour(new Date(noon.getTime() + 24 * 36e5), OPEN);
}

/** Business hours from `start` up to `end`. Zero when `end` is not after `start`. */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  let total = 0;
  let cursor = new Date(start);
  for (let guard = 0; cursor < end && guard < 4000; guard += 1) {
    if (isWeekday(cursor)) {
      const open = atHour(cursor, OPEN);
      const close = atHour(cursor, CLOSE);
      const from = Math.max(cursor.getTime(), open.getTime());
      const to = Math.min(end.getTime(), close.getTime());
      if (to > from) total += (to - from) / 36e5;
    }
    cursor = nextMorning(cursor);
  }
  return total;
}

/** Move forward by business hours. The inverse of businessHoursBetween inside the work week. */
export function addBusinessHours(start: Date, hours: number): Date {
  let left = hours;
  let cursor = new Date(start);
  for (let guard = 0; left > 1e-9 && guard < 4000; guard += 1) {
    const close = atHour(cursor, CLOSE);
    const open = atHour(cursor, OPEN);
    if (!isWeekday(cursor) || cursor.getTime() >= close.getTime()) {
      cursor = nextMorning(cursor);
      continue;
    }
    if (cursor.getTime() < open.getTime()) cursor = open;
    const room = (close.getTime() - cursor.getTime()) / 36e5;
    if (left <= room + 1e-9) return new Date(cursor.getTime() + left * 36e5);
    left -= room;
    cursor = nextMorning(cursor);
  }
  return cursor;
}

/** Under 4h, 4–24h, over 24h. */
export function ageBucket(hours: number): 0 | 1 | 2 {
  if (hours < 4) return 0;
  if (hours <= 24) return 1;
  return 2;
}

export function fmtBusiness(hours: number): string {
  if (hours < 1 / 60) return "0m";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

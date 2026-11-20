/** Weekdays 8:00–17:00. Nights and weekends do not count. */

const OPEN = 8;
const CLOSE = 17;

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/** Business hours from `start` up to `end`. Zero when `end` is not after `start`. */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  let total = 0;
  const cursor = new Date(start);
  for (let guard = 0; cursor < end && guard < 4000; guard += 1) {
    if (isWeekday(cursor)) {
      const open = new Date(cursor);
      open.setHours(OPEN, 0, 0, 0);
      const close = new Date(cursor);
      close.setHours(CLOSE, 0, 0, 0);
      const from = Math.max(cursor.getTime(), open.getTime());
      const to = Math.min(end.getTime(), close.getTime());
      if (to > from) total += (to - from) / 36e5;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return total;
}

/** Move forward by business hours. The inverse of businessHoursBetween inside the work week. */
export function addBusinessHours(start: Date, hours: number): Date {
  let left = hours;
  const cursor = new Date(start);
  for (let guard = 0; left > 1e-9 && guard < 4000; guard += 1) {
    const close = new Date(cursor);
    close.setHours(CLOSE, 0, 0, 0);
    const open = new Date(cursor);
    open.setHours(OPEN, 0, 0, 0);
    if (!isWeekday(cursor) || cursor.getTime() >= close.getTime()) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(OPEN, 0, 0, 0);
      continue;
    }
    if (cursor.getTime() < open.getTime()) cursor.setTime(open.getTime());
    const room = (close.getTime() - cursor.getTime()) / 36e5;
    if (left <= room + 1e-9) {
      cursor.setTime(cursor.getTime() + left * 36e5);
      return cursor;
    }
    left -= room;
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(OPEN, 0, 0, 0);
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

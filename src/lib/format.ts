const dateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dobFmt = new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

export function fmtDate(d: Date): string {
  return dateFmt.format(d);
}

/** "Tue, Nov 10, 9:00 AM" */
export function fmtScan(d: Date): string {
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export function fmtTime(d: Date): string {
  return timeFmt.format(d);
}

export function fmtDemoClock(d: Date): string {
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}

export function fmtDob(iso: string): string {
  // Parse as local noon so the date never shifts across time zones.
  return dobFmt.format(new Date(`${iso}T12:00:00`));
}

/** "in 9d 1h", "in 18h", "in 40m", "2h ago" */
export function fmtCountdown(target: Date, now: Date): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 6e4);
  const abs = Math.abs(mins);
  const body = fmtDuration(abs);
  return mins >= 0 ? `in ${body}` : `${body} ago`;
}

/** Minutes → "15m", "6h 30m", "2d 1h" */
export function fmtDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const m = totalMinutes % 60;
    return m ? `${hours}h ${m}m` : `${hours}h`;
  }
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 6e4));
}

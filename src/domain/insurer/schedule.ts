import { businessHoursBetween, isBusinessDay, subtractBusinessDays } from "@/domain/timeRisk";
import type { InsurerConfig } from "./config";

function atTime(day: Date, hhmm: string): Date {
  const [hour, minute] = hhmm.split(":").map((part) => Number(part));
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** Next time this insurer should be checked. API is every N hours. Portal is 08:00 and 14:00 on business days. */
export function nextStatusCheck(config: InsurerConfig, after: Date): Date {
  if (config.channel !== "portal_automation") {
    return new Date(after.getTime() + config.statusEveryHours * 36e5);
  }
  const times = [...config.portalTimes].sort();
  for (let add = 0; add < 14; add += 1) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + add);
    if (!isBusinessDay(day)) continue;
    for (const hhmm of times) {
      const slot = atTime(day, hhmm);
      if (slot.getTime() > after.getTime()) return slot;
    }
  }
  return new Date(after.getTime() + 24 * 36e5);
}

export function retryAt(config: InsurerConfig, after: Date, attempt: number): Date {
  const minutes = config.retryMinutes[Math.min(attempt - 1, config.retryMinutes.length - 1)] ?? 60;
  return new Date(after.getTime() + minutes * 60 * 1000);
}

/** No final decision, and the scan is inside 24 business hours. The status is left alone. */
export function decisionScanAtRisk(status: string, scanAt: Date | null, now: Date): boolean {
  if (!scanAt) return false;
  if (status !== "SUBMITTED" && status !== "submitted") return false;
  return businessHoursBetween(now, scanAt) <= 24;
}

export function approvalExpiring(validTo: string, now: Date, businessDays = 3): boolean {
  const target = new Date(validTo.includes("T") ? validTo : `${validTo}T12:00:00`);
  const start = subtractBusinessDays(target, businessDays);
  return now.getTime() >= start.getTime() && now.getTime() <= target.getTime();
}

const DOC_WORD = /\b(notes?|reports?|exams?|records?|documents?|imaging|therapy)\b/i;

export function pendNamesDocument(raw: string): boolean {
  return DOC_WORD.test(raw);
}

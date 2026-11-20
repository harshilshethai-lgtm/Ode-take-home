import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { getReviewPanel } from "@/domain/review/panel";
import { fixByAt } from "@/domain/timeRisk";
import { fmtTableDate } from "@/lib/format";
import {
  DEMO_NOW,
  demoDateKey,
  formatFixBy,
  nextDemoStamp,
  parseDemoInstant,
  relativeToClock,
  resetDemoClock,
} from "@/lib/demoClock";

const DOCUMENT_AT: Record<string, string> = {
  "case-1-kirk": "2026-11-09T15:38:00",
  "case-2-scott": "2026-11-10T08:52:00",
  "case-3-sulu": "2026-11-10T13:05:00",
};

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

function monthDay(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/.exec(label.trim());
  if (!match) return null;
  return `2026-${MONTHS[match[1]]}-${match[2].padStart(2, "0")}`;
}

describe("demo clock", () => {
  it("is 2:00 PM Eastern on Tuesday, Nov 10, 2026", () => {
    expect(DEMO_NOW.toISOString()).toBe("2026-11-10T19:00:00.000Z");
    expect(demoDateKey(DEMO_NOW)).toBe("2026-11-10");
    expect(fmtTableDate(DEMO_NOW).replace(/\u202f|\u00a0/g, " ")).toBe("Tue 11/10 · 2:00 PM");
  });

  it("reads a naive timestamp as Eastern wall time", () => {
    expect(parseDemoInstant("2026-11-10T14:00:00").toISOString()).toBe(DEMO_NOW.toISOString());
    expect(parseDemoInstant("2026-11-10T19:00:00.000Z").toISOString()).toBe(DEMO_NOW.toISOString());
  });

  it("places Kirk's 3:45 PM submission the previous afternoon", () => {
    expect(relativeToClock("2026-11-09T15:45:00")).toBe("22h 15m ago");
  });

  it("marks Sulu's fix-by past due once the clock is the afternoon he was ordered", () => {
    const fix = fixByAt(parseDemoInstant("2026-11-16T11:00:00"), "Andorian Life");
    expect(fix.getTime()).toBeLessThan(parseDemoInstant("2026-11-10T13:05:00").getTime());
    expect(formatFixBy(fix).replace(/\u202f|\u00a0/g, " ")).toBe("Past due · Tue 11/10");
  });

  it("puts audit stamps back on the epoch when the demo is reset", () => {
    resetDemoClock();
    const first = nextDemoStamp();
    nextDemoStamp();
    resetDemoClock();
    expect(nextDemoStamp()).toBe(first);
    resetDemoClock();
  });
});

describe("seed events stay on the demo clock", () => {
  it("fails when an event is after the clock or before the document it depends on", () => {
    const now = DEMO_NOW.getTime();
    const today = demoDateKey(DEMO_NOW);
    for (const order of SEED_ORDERS) {
      const since = parseDemoInstant(order.statusSince).getTime();
      expect(since, `${order.id} status`).toBeLessThanOrEqual(now);
      const anchor = DOCUMENT_AT[order.id];
      const anchorAt = anchor ? parseDemoInstant(anchor).getTime() : null;
      if (anchorAt != null) expect(since, `${order.id} before its document`).toBeGreaterThanOrEqual(anchorAt);

      const requested = [order.detail.requested, ...order.otherIssues.map((issue) => issue.detail.requested)];
      for (const label of requested) {
        const day = monthDay(label);
        if (!day) continue;
        expect(day <= today, `${order.id} requested ${String(label)}`).toBe(true);
        if (anchor) expect(day >= demoDateKey(parseDemoInstant(anchor)), `${order.id} requested ${String(label)}`).toBe(true);
      }
      if (order.followUpDueAt && anchorAt != null) {
        expect(parseDemoInstant(order.followUpDueAt).getTime(), `${order.id} follow-up`).toBeGreaterThanOrEqual(anchorAt);
      }

      const panel = getReviewPanel(order.id, "coordinator", order);
      if (panel.checks.receivedAt) {
        const received = new Date(panel.checks.receivedAt).getTime();
        expect(received, `${order.id} received`).toBeLessThanOrEqual(now);
        if (anchorAt != null) expect(received, `${order.id} received before document`).toBeGreaterThanOrEqual(anchorAt);
      }
      if (panel.checks.evaluatedAt) {
        const evaluated = new Date(panel.checks.evaluatedAt).getTime();
        expect(evaluated, `${order.id} evaluated`).toBeLessThanOrEqual(now);
        if (panel.checks.receivedAt) {
          expect(evaluated, `${order.id} evaluated before receipt`).toBeGreaterThanOrEqual(new Date(panel.checks.receivedAt).getTime());
        }
      }
    }
  });
});

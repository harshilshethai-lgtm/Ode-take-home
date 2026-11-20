import { describe, expect, it } from "vitest";
import { DEMO_NOW, SEED_ORDERS } from "@/data/orders";
import { parseDemoInstant } from "@/lib/demoClock";
import { METRICS, OPS_METRICS } from "@/data/impact/metrics";
import { HOSPITAL, autonomyFor, queueOwner } from "@/data/operations/queue";
import { STATUSES, isClosed } from "@/domain/statuses";
import type { Order } from "@/domain/types";
import { addBusinessHours, businessHoursBetween } from "@/domain/operations/time";
import {
  attentionItems,
  buildOperations,
  isPastDue,
  isSlotAtRisk,
  trackTone,
} from "@/domain/operations/model";

const ALL = { hospital: null, insurer: null, period: "week" as const };

describe("business hours", () => {
  it("counts only weekday hours between 8:00 and 5:00 Eastern", () => {
    const monday = parseDemoInstant("2026-11-09T10:00:00");
    expect(businessHoursBetween(monday, parseDemoInstant("2026-11-09T14:00:00"))).toBe(4);
    expect(businessHoursBetween(parseDemoInstant("2026-11-09T16:00:00"), parseDemoInstant("2026-11-10T10:00:00"))).toBe(3);
    expect(businessHoursBetween(parseDemoInstant("2026-11-13T16:00:00"), parseDemoInstant("2026-11-16T09:00:00"))).toBe(2);
  });

  it("adds business hours as the inverse", () => {
    const start = parseDemoInstant("2026-11-04T10:00:00");
    const end = addBusinessHours(start, 14);
    expect(businessHoursBetween(start, end)).toBeCloseTo(14, 5);
  });
});

describe("operations snapshot", () => {
  const model = buildOperations(SEED_ORDERS, ALL);

  it("counts the open worklist by owner", () => {
    const open = SEED_ORDERS.filter((order) => !isClosed(order.status));
    expect(open).toHaveLength(22);
    const counts = Object.fromEntries(model.queue.map((row) => [row.id, row.count]));
    expect(counts).toEqual({ ai: 2, coordinator: 11, nurse: 4, insurer: 5 });
    for (const order of open) {
      const owner = queueOwner(order.status, autonomyFor(order.insurer, order.channel));
      expect(owner).not.toBe("done");
    }
    expect(model.queue.find((row) => row.id === "coordinator")?.reasons).toEqual([
      { label: "Missing docs", count: 2 },
      { label: "Under 6 weeks", count: 1 },
      { label: "Unreadable", count: 2 },
      { label: "Side mismatch", count: 1 },
      { label: "Wrong-patient page", count: 1 },
      { label: "Insurer mismatch", count: 1 },
      { label: "Ready · portal submit (manual)", count: 3 },
    ]);
    expect(model.queue.find((row) => row.id === "nurse")?.reasons).toEqual([
      { label: "Criteria not met", count: 3 },
      { label: "Rule gap", count: 1 },
    ]);
    expect(model.doneToday).toEqual([]);
  });

  it("puts slots at risk ahead of past-due cases, then earliest due", () => {
    expect(model.attention.map((row) => row.orderId)).toEqual([
      "case-2-scott",
      "case-13-laforge",
      "case-12-crusher",
      "case-18-sisko",
      "case-19-kira",
      "case-17-obrien",
      "case-15-nog",
      "case-10-riker",
      "case-20-odo",
      "case-8-paris",
    ]);
    expect(model.attention[0]?.slotAtRisk).toBe(true);
    expect(model.attention.slice(1).every((row) => row.pastDue && !row.slotAtRisk)).toBe(true);
    expect(model.attention.find((row) => row.pastDue)?.dueText.startsWith("Past due by ")).toBe(true);

    const soon: Order = {
      ...SEED_ORDERS[0],
      id: "slot-soon",
      scheduledAt: new Date(DEMO_NOW.getTime() + 2 * 36e5).toISOString(),
      statusSince: DEMO_NOW.toISOString(),
      status: "submitted",
    };
    const rows = attentionItems([soon, ...SEED_ORDERS], ALL);
    const soonRow = rows.find((row) => row.orderId === "slot-soon");
    const firstQuiet = rows.findIndex((row) => !row.slotAtRisk);
    expect(rows.findIndex((row) => row.orderId === "slot-soon")).toBeLessThan(firstQuiet);
    expect(soonRow?.dueText.startsWith("in ")).toBe(true);
    expect(soonRow?.slotAtRisk).toBe(true);
    expect(isSlotAtRisk(soon)).toBe(true);
    expect(isPastDue(soon)).toBe(false);
  });

  it("gives every status an owner", () => {
    for (const status of Object.keys(STATUSES) as (keyof typeof STATUSES)[]) {
      expect(() => queueOwner(status, "automatic")).not.toThrow();
      expect(() => queueOwner(status, "assisted")).not.toThrow();
    }
  });

  it("reads this week's scorecard from the request cases, and the sparkline ends on that value", () => {
    const noNurse = model.tiles[0];
    expect(noNurse.metric).toBe(OPS_METRICS.no_nurse_submit);
    expect(noNurse.metric.target).toBe(0.5);
    expect(noNurse.value).toBeCloseTo(35 / 76, 5);
    expect(noNurse.series[7]).toBe(noNurse.value);
    expect(trackTone("higher", noNurse.value!, noNurse.metric.target!)).toBe("hold");

    const hours = model.tiles[1];
    expect(hours.value).toBe(6.5);
    expect(trackTone("lower", hours.value!, hours.metric.target!)).toBe("ready");

    const intake = model.tiles[2];
    expect(intake.value).toBeCloseTo(24 / 29, 5);
    expect(trackTone("higher", intake.value!, intake.metric.target!)).toBe("hold");

    const spot = model.tiles[3];
    expect(spot.metric).toBe(METRICS.spot_check);
    expect(spot.metric.target).toBe(0.95);
    expect(spot.value).toBeCloseTo(15 / 16, 5);

    const overturned = model.tiles[4];
    expect(overturned.metric.target).toBe(0.01);
    expect(overturned.value).toBe(0);
  });

  it("changes the headline when the period is today", () => {
    const today = buildOperations(SEED_ORDERS, { ...ALL, period: "today" });
    expect(today.tiles[0].value).not.toBe(model.tiles[0].value);
    expect(today.tiles[0].series[7]).toBe(model.tiles[0].value);
  });

  it("flags the insurer whose AI-ready denials sit above its matched baseline", () => {
    const ferengi = model.byInsurer.find((row) => row.insurer === "Ferengi Benefit Group");
    expect(ferengi?.requests).toBe(16);
    expect(ferengi?.autonomy).toBe("assisted");
    expect(ferengi?.aiReadyDenial).toBeGreaterThan(ferengi?.matchedBaseline ?? 1);
    expect(model.byInsurer[0]?.insurer).toBe("Federation Health");
    expect(model.byInsurer.find((row) => row.insurer === "Federation Health")?.open).toBe(3);
    expect(model.byInsurer.find((row) => row.insurer === "Vulcan Science Mutual")?.open).toBe(1);
    expect(model.byInsurer.find((row) => row.insurer === "Klingon Assurance")?.open).toBe(1);
  });

  it("scopes the queue to one insurer without leaving the worklist", () => {
    const scoped = buildOperations(SEED_ORDERS, { hospital: HOSPITAL, insurer: "Ferengi Benefit Group", period: "week" });
    const expected = SEED_ORDERS.filter(
      (order) => !isClosed(order.status) && order.insurer === "Ferengi Benefit Group",
    );
    const shown = scoped.queue.reduce((sum, row) => sum + row.count, 0);
    expect(shown).toBe(expected.length);
  });
});

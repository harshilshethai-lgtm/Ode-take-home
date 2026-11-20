import { describe, expect, it } from "vitest";
import {
  CARD_IDS,
  DEFAULT_ASSUMPTIONS,
  GUARDRAIL_IDS,
  METRICS,
  type Assumptions,
} from "@/data/impact/metrics";
import { ILLUSTRATIVE, WEEKS } from "@/data/impact/weeks";
import {
  buildImpactModel,
  chartBaseline,
  isBreached,
  readMetric,
  weekDollars,
} from "@/domain/impact/compute";
import { fmtDelta, formatMetric } from "@/domain/impact/format";

const priced = { ...DEFAULT_ASSUMPTIONS, coordCostPerHour: 45 };

describe("metric config", () => {
  it("is the illustrative series the page is allowed to show", () => {
    expect(ILLUSTRATIVE).toBe(true);
    expect(WEEKS).toHaveLength(13);
    expect(WEEKS[0].week).toBe(0);
    expect(WEEKS[12].week).toBe(12);
  });

  it("gives every metric the five popover fields", () => {
    for (const metric of Object.values(METRICS)) {
      expect(metric.name.length).toBeGreaterThan(0);
      expect(metric.definition.length).toBeGreaterThan(20);
      expect(metric.formula.length).toBeGreaterThan(5);
      expect(metric.baselineDetail.length).toBeGreaterThan(5);
      expect(metric.whyItMatters.length).toBeGreaterThan(5);
      expect(["higher", "lower"]).toContain(metric.direction);
      expect(["brief", "assumption", "measured"]).toContain(metric.baselineSource);
    }
  });
});

describe("pilot series", () => {
  it("keeps the first phase on the brief baselines", () => {
    for (const row of WEEKS.filter((week) => week.phase === "shadowWeeks")) {
      expect(row.northStar).toBe(0);
      expect(row.nurseTouch).toBe(1);
      expect(row.coordMinutes).toBe(18);
      expect(row.denialRate).toBe(0.11);
    }
  });

  it("marks lagging weeks incomplete", () => {
    expect(WEEKS.filter((week) => week.incomplete.wrongNotNeeded).map((week) => week.week)).toEqual([10, 11, 12]);
    expect(WEEKS.filter((week) => week.incomplete.denialRate).map((week) => week.week)).toEqual([11, 12]);
  });

  it("lands the guardrail example on the latest complete weeks", () => {
    expect(WEEKS[12].spotCheckAgreement).toBe(0.96);
    expect(WEEKS[10].aiReadyDenial).toBe(0.031);
    expect(WEEKS[10].matchedBaselineDenial).toBe(0.058);
  });
});

describe("value math", () => {
  it("prices nurse time from the 18 minute review and the nurse cost", () => {
    const out = METRICS.nurse_touch.value({
      current: 0.35,
      baseline: 1,
      requests: 1000,
      assumptions: DEFAULT_ASSUMPTIONS,
    });
    expect(out.hours).toBeCloseTo(195);
    expect(out.dollars).toBeCloseTo(12090);
  });

  it("drops nurse dollars when the cost is empty and keeps the hours", () => {
    const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, nurseCostPerHour: null };
    const out = METRICS.nurse_touch.value({ current: 0.35, baseline: 1, requests: 1000, assumptions });
    expect(out.dollars).toBeNull();
    expect(out.hours).toBeCloseTo(195);
  });

  it("leaves coordinator time and denials out of the default total", () => {
    const model = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
    const byName = Object.fromEntries(model.levers.map((lever) => [lever.name, lever.cumulative]));
    expect(byName["Nurse time"]).toBeGreaterThan(0);
    expect(byName["Lost scans recovered"]).toBeGreaterThan(0);
    expect(byName["Unpaid scans avoided"]).toBeGreaterThan(0);
    expect(byName["Coordinator time"]).toBeNull();
    expect(byName["Denials avoided"]).toBeNull();
    const included = model.levers.filter((lever) => lever.cumulative != null).reduce((sum, lever) => sum + (lever.cumulative ?? 0), 0);
    expect(model.total).toBeCloseTo(included);
  });

  it("adds coordinator dollars once a cost is set", () => {
    const before = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
    const after = buildImpactModel(WEEKS, "toDate", "all", priced);
    expect(after.levers.find((lever) => lever.name === "Coordinator time")?.cumulative).toBeGreaterThan(0);
    expect(after.total ?? 0).toBeGreaterThan(before.total ?? 0);
  });

  it("drops scan levers when revenue is empty", () => {
    const model = buildImpactModel(WEEKS, "toDate", "all", { ...DEFAULT_ASSUMPTIONS, revenuePerScan: null });
    expect(model.levers.find((lever) => lever.name === "Lost scans recovered")?.cumulative).toBeNull();
    expect(model.levers.find((lever) => lever.name === "Unpaid scans avoided")?.cumulative).toBeNull();
    expect(model.levers.find((lever) => lever.name === "Nurse time")?.cumulative).toBeGreaterThan(0);
  });

  it("does not add value for incomplete wrong-call weeks", () => {
    const metric = METRICS.wrong_not_needed;
    const baseline = chartBaseline(metric, WEEKS);
    const week9 = weekDollars(metric, WEEKS[9], baseline, DEFAULT_ASSUMPTIONS, "all");
    const week12 = weekDollars(metric, WEEKS[12], baseline, DEFAULT_ASSUMPTIONS, "all");
    expect(week9).toBeGreaterThan(0);
    expect(week12).toBe(0);
  });

  it("scales the run rate with monthly requests", () => {
    const base = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
    const doubled = buildImpactModel(WEEKS, "toDate", "all", { ...DEFAULT_ASSUMPTIONS, requestsPerMonth: 24000 });
    expect(doubled.runRate).toBeCloseTo((base.runRate ?? 0) * 2);
  });

  it("shrinks dollars to the pilot hospital", () => {
    const all = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
    const pilot = buildImpactModel(WEEKS, "toDate", "pilot", DEFAULT_ASSUMPTIONS);
    expect(pilot.total ?? 0).toBeLessThan(all.total ?? 0);
  });

  it("reads the latest complete week for a lagging metric", () => {
    const reading = readMetric(METRICS.denial_rate, WEEKS, "toDate", "all");
    expect(reading.weeks).toEqual([10]);
    expect(reading.partial).toBe(true);
    expect(reading.value).toBe(0.083);
  });
});

describe("direction and guardrails", () => {
  it("colors a falling touch rate as an improvement", () => {
    expect(fmtDelta(METRICS.nurse_touch, 0.35, 1)).toBe("−65 pt");
    expect(formatMetric(METRICS.north_star, 0.6)).toBe("60%");
  });

  it("flags a guardrail only when it misses its bar", () => {
    expect(isBreached(METRICS.spot_check, 0.96, 0.92, 0.95)).toBe(false);
    expect(isBreached(METRICS.spot_check, 0.94, 0.92, 0.95)).toBe(true);
    expect(isBreached(METRICS.ai_ready_denial, 0.031, 0.058, null)).toBe(false);
    expect(isBreached(METRICS.ai_ready_denial, 0.07, 0.058, null)).toBe(true);
  });

  it("shows the example guardrail lines for the default range", () => {
    const model = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
    expect(model.guardrails.map((guard) => guard.text)).toEqual([
      "Spot-check agreement 96% (target ≥ 95%)",
      "Denials on AI-ready requests 3.1% vs 5.8% matched baseline",
    ]);
    expect(model.guardrails.every((guard) => !guard.breached)).toBe(true);
  });
});

describe("cards", () => {
  it("covers the five levers and both guardrails", () => {
    expect(CARD_IDS).toHaveLength(5);
    expect(GUARDRAIL_IDS).toHaveLength(2);
  });
});

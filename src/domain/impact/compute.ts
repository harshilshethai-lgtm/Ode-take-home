import {
  CARD_IDS,
  GUARDRAIL_IDS,
  LEVER_IDS,
  METRICS,
  type Assumptions,
  type MetricDef,
  type MetricId,
  type SeriesKey,
  type ValueOutput,
} from "@/data/impact/metrics";
import type { WeekRow } from "@/data/impact/weeks";
import { deltaTone, fmtDelta, formatMetric, guardrailCopy, valueLine, windowCopy } from "@/domain/impact/format";

export type RangeId = "toDate" | "last4";
export type ScopeId = "pilot" | "all";

export interface Reading {
  value: number;
  weeks: number[];
  /** Later weeks exist but were left out because the outcome has not arrived. */
  partial: boolean;
}

export interface MetricView {
  metric: MetricDef;
  reading: Reading;
  baseline: number | null;
  target: number | null;
  valueText: string;
  delta: string | null;
  tone: "good" | "bad" | "flat";
  window: string;
  annualLine: string;
}

export interface GuardrailView {
  metric: MetricDef;
  text: string;
  breached: boolean;
  baseline: number | null;
  window: string;
}

export interface LeverView {
  id: MetricId;
  name: string;
  /** Null when the baseline or the unit cost is not set. Left out of the total. */
  cumulative: number | null;
}

export interface CumulativePoint {
  week: number;
  [series: string]: number;
}

export interface ImpactModel {
  north: MetricView;
  cards: MetricView[];
  guardrails: GuardrailView[];
  total: number | null;
  runRate: number | null;
  levers: LeverView[];
  /** Priced levers only, bottom of the stack first. */
  stack: { id: SeriesKey; name: string; metricId: MetricId }[];
  series: CumulativePoint[];
}

export function scopedRequests(row: WeekRow, scope: ScopeId): number {
  return scope === "pilot" ? row.pilotRequests : row.requests;
}

export function scopedSample(row: WeekRow, key: SeriesKey, scope: ScopeId): number {
  const base = row.n[key];
  if (scope === "all" || row.requests === 0) return base;
  return Math.max(1, Math.round((base * row.pilotRequests) / row.requests));
}

function weighted(rows: WeekRow[], valueOf: (row: WeekRow) => number, scope: ScopeId): number | null {
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const w = scopedRequests(row, scope);
    num += valueOf(row) * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}

export function shadowBaseline(metric: MetricDef, rows: WeekRow[]): number | null {
  const early = rows.filter((row) => row.phase === "shadowWeeks");
  return weighted(early, (row) => row[metric.series], "all");
}

/** Horizontal reference line. Null when the baseline is a band or is not set. */
export function chartBaseline(metric: MetricDef, rows: WeekRow[]): number | null {
  if (metric.baselineMode === "fixed") return metric.baseline;
  if (metric.baselineMode === "measured") return shadowBaseline(metric, rows);
  return null;
}

export function chartTarget(metric: MetricDef, baseline: number | null): number | null {
  if (metric.targetMode === "none") return null;
  if (metric.targetMode === "half") return baseline == null ? null : baseline / 2;
  return metric.target;
}

function usable(metric: MetricDef, row: WeekRow): boolean {
  return metric.lag == null || !row.incomplete[metric.lag];
}

export function readMetric(metric: MetricDef, rows: WeekRow[], range: RangeId, scope: ScopeId): Reading {
  const last = rows[rows.length - 1];
  if (range === "last4") {
    const window = rows.slice(-4);
    const kept = window.filter((row) => usable(metric, row));
    const source = kept.length > 0 ? kept : window;
    return {
      value: weighted(source, (row) => row[metric.series], scope) ?? source[source.length - 1][metric.series],
      weeks: source.map((row) => row.week),
      partial: kept.length !== window.length,
    };
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (usable(metric, rows[i])) {
      return {
        value: rows[i][metric.series],
        weeks: [rows[i].week],
        partial: rows[i].week !== last.week,
      };
    }
  }
  return { value: last[metric.series], weeks: [last.week], partial: true };
}

export function readingBaseline(metric: MetricDef, rows: WeekRow[], reading: Reading, scope: ScopeId): number | null {
  if (metric.baselineMode === "fixed") return metric.baseline;
  if (metric.baselineMode === "measured") return shadowBaseline(metric, rows);
  if (metric.matchedKey == null) return null;
  const key = metric.matchedKey;
  const picked = rows.filter((row) => reading.weeks.includes(row.week));
  return weighted(picked, (row) => row[key], scope);
}

/** Monthly volume for the selected scope. The input is the network total. */
export function scopedMonthly(assumptions: Assumptions, scope: ScopeId, rows: WeekRow[]): number | null {
  if (assumptions.requestsPerMonth == null) return null;
  if (scope === "all") return assumptions.requestsPerMonth;
  const recent = rows.slice(-4);
  const pilot = recent.reduce((sum, row) => sum + row.pilotRequests, 0);
  const all = recent.reduce((sum, row) => sum + row.requests, 0);
  if (all === 0) return assumptions.requestsPerMonth;
  return assumptions.requestsPerMonth * (pilot / all);
}

function annualize(period: ValueOutput): ValueOutput {
  return {
    dollars: period.dollars == null ? null : period.dollars * 12,
    hours: period.hours == null ? null : period.hours * 12,
  };
}

function viewFor(metric: MetricDef, rows: WeekRow[], range: RangeId, scope: ScopeId, assumptions: Assumptions): MetricView {
  const reading = readMetric(metric, rows, range, scope);
  const baseline = readingBaseline(metric, rows, reading, scope);
  const target = chartTarget(metric, chartBaseline(metric, rows));
  const monthly = scopedMonthly(assumptions, scope, rows);
  const annual =
    monthly == null
      ? { dollars: null, hours: null }
      : annualize(metric.value({ current: reading.value, baseline, requests: monthly, assumptions }));
  return {
    metric,
    reading,
    baseline,
    target,
    valueText: formatMetric(metric, reading.value),
    delta: baseline == null ? null : fmtDelta(metric, reading.value, baseline),
    tone: baseline == null ? "flat" : deltaTone(metric, reading.value, baseline),
    window: windowCopy(reading.weeks, reading.partial),
    annualLine: valueLine(annual),
  };
}

export function isBreached(metric: MetricDef, current: number, baseline: number | null, target: number | null): boolean {
  if (metric.breach === "under-target") return target != null && current < target;
  if (metric.breach === "over-baseline") return baseline != null && current > baseline;
  return false;
}

/** Dollars added that week. Null means the lever cannot be priced at all. */
export function weekDollars(
  metric: MetricDef,
  row: WeekRow,
  baseline: number | null,
  assumptions: Assumptions,
  scope: ScopeId,
): number | null {
  const priced = metric.value({
    current: row[metric.series],
    baseline,
    requests: scopedRequests(row, scope),
    assumptions,
  });
  if (priced.dollars == null) return null;
  if (metric.lag != null && row.incomplete[metric.lag]) return 0;
  return priced.dollars;
}

export function buildImpactModel(
  rows: WeekRow[],
  range: RangeId,
  scope: ScopeId,
  assumptions: Assumptions,
): ImpactModel {
  const north = viewFor(METRICS.north_star, rows, range, scope, assumptions);
  const cards = CARD_IDS.map((id) => viewFor(METRICS[id], rows, range, scope, assumptions));
  const guardrails: GuardrailView[] = GUARDRAIL_IDS.map((id) => {
    const metric = METRICS[id];
    const reading = readMetric(metric, rows, range, scope);
    const baseline = readingBaseline(metric, rows, reading, scope);
    const target = chartTarget(metric, chartBaseline(metric, rows));
    return {
      metric,
      text: guardrailCopy(metric, reading.value, baseline),
      breached: isBreached(metric, reading.value, baseline, target),
      baseline,
      window: windowCopy(reading.weeks, reading.partial),
    };
  });

  const levers: LeverView[] = LEVER_IDS.map((id) => {
    const metric = METRICS[id];
    const baseline = chartBaseline(metric, rows);
    let cumulative = 0;
    let priced = true;
    for (const row of rows) {
      const add = weekDollars(metric, row, baseline, assumptions, scope);
      if (add == null) {
        priced = false;
        break;
      }
      cumulative += add;
    }
    return { id, name: metric.lever ?? metric.name, cumulative: priced ? cumulative : null };
  });

  const priced = levers.filter((lever) => lever.cumulative != null);
  const stack = priced.map((lever) => ({
    id: METRICS[lever.id].series,
    name: lever.name,
    metricId: lever.id,
  }));
  const baselineOf = new Map(stack.map((item) => [item.metricId, chartBaseline(METRICS[item.metricId], rows)]));
  const running: Partial<Record<SeriesKey, number>> = {};
  for (const item of stack) running[item.id] = 0;
  const series: CumulativePoint[] = rows.map((row) => {
    const point: CumulativePoint = { week: row.week };
    for (const item of stack) {
      const metric = METRICS[item.metricId];
      const add = weekDollars(metric, row, baselineOf.get(item.metricId) ?? null, assumptions, scope) ?? 0;
      running[item.id] = (running[item.id] ?? 0) + add;
      point[item.id] = running[item.id] ?? 0;
    }
    return point;
  });

  return {
    north,
    cards,
    guardrails,
    total: priced.length === 0 ? null : priced.reduce((sum, lever) => sum + (lever.cumulative ?? 0), 0),
    runRate: runRate(rows, assumptions, scope),
    levers,
    stack,
    series,
  };
}

function runRate(rows: WeekRow[], assumptions: Assumptions, scope: ScopeId): number | null {
  const monthly = scopedMonthly(assumptions, scope, rows);
  if (monthly == null) return null;
  const recent = rows.slice(-4);
  let total = 0;
  let any = false;
  for (const id of LEVER_IDS) {
    const metric = METRICS[id];
    const baseline = chartBaseline(metric, rows);
    const kept = recent.filter((row) => usable(metric, row));
    const source = kept.length > 0 ? kept : recent;
    const current = weighted(source, (row) => row[metric.series], scope);
    if (current == null) continue;
    const annual = annualize(metric.value({ current, baseline, requests: monthly, assumptions }));
    if (annual.dollars == null) continue;
    any = true;
    total += annual.dollars;
  }
  return any ? total : null;
}

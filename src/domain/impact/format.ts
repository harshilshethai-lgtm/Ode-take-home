import {
  DENIAL_MINUTES,
  DIRECTION_LABEL,
  NURSE_REVIEW_MINUTES,
  type Assumptions,
  type Direction,
  type MetricDef,
  type Unit,
  NEEDS_DATA_LABEL,
} from "@/data/impact/metrics";

export function formatMetric(metric: { unit: Unit }, value: number): string {
  if (metric.unit === "percent") return `${trim(value * 100)}%`;
  if (metric.unit === "hours") return `${trim(value)}h`;
  return `${trim(value)} min`;
}

export function formatTick(metric: MetricDef, value: number): string {
  if (metric.unit === "percent") return String(Math.round(value * 100));
  return String(Math.round(value));
}

export function unitLabel(metric: { unit: Unit }): string {
  if (metric.unit === "percent") return "%";
  if (metric.unit === "hours") return "h";
  return "min";
}

/** Signed change versus baseline, in percentage points or minutes. */
export function fmtDelta(metric: { unit: Unit; direction: Direction }, current: number, baseline: number): string {
  const raw = metric.unit === "percent" ? (current - baseline) * 100 : current - baseline;
  const suffix = metric.unit === "percent" ? "pt" : metric.unit === "hours" ? "h" : "min";
  return `${signed(raw)} ${suffix}`;
}

export function deltaTone(metric: { unit: Unit; direction: Direction }, current: number, baseline: number): "good" | "bad" | "flat" {
  const label = fmtDelta(metric, current, baseline);
  if (label.startsWith("0")) return "flat";
  const improved = metric.direction === "higher" ? current > baseline : current < baseline;
  return improved ? "good" : "bad";
}

export function directionCaption(direction: Direction): string {
  return DIRECTION_LABEL[direction].toLowerCase();
}

export function baselineCopy(metric: { unit: Unit; baselineDetail: string }, value: number | null): string {
  const number = value == null ? "Not set" : formatMetric(metric, value);
  return `${number}. ${metric.baselineDetail}`;
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  const v = Math.abs(n);
  if (v >= 10_000_000) return `${sign}$${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${sign}$${m >= 10 ? Math.round(m) : trim(m)}M`;
  }
  if (v >= 10_000) return `${sign}$${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${sign}$${trim(v / 1000)}k`;
  return `${sign}$${Math.round(v).toLocaleString("en-US")}`;
}

export function fmtMoneyTick(n: number): string {
  const v = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (v >= 1_000_000) return `${sign}${trim(v / 1_000_000)}M`;
  if (v >= 1000) return `${sign}${Math.round(v / 1000)}k`;
  return `${sign}${Math.round(v)}`;
}

export function fmtHours(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(n)).toLocaleString("en-US")} hr`;
}

export function valueLine(annual: { dollars: number | null; hours: number | null }, hoursLabel?: "nurse"): string {
  if (annual.dollars != null) return `≈ ${fmtMoney(annual.dollars)}/yr at current rate`;
  if (annual.hours != null) {
    const unit = hoursLabel === "nurse" ? "nurse hr" : "hr";
    const sign = annual.hours < 0 ? "−" : "";
    return `≈ ${sign}${Math.abs(Math.round(annual.hours)).toLocaleString("en-US")} ${unit}/yr`;
  }
  return NEEDS_DATA_LABEL;
}

/** One-line formula for the assumptions drawer. Same inputs the card's annual figure uses. */
export function leverFormula(metric: MetricDef, current: number, baseline: number | null, assumptions: Assumptions): string {
  const requests = assumptions.requestsPerMonth;
  if (requests == null) return "Set monthly requests to price this.";
  const volume = requests.toLocaleString("en-US");
  const now = formatMetric(metric, current);
  const base = baseline == null ? "baseline" : formatMetric(metric, baseline);
  if (metric.id === "nurse_touch") {
    const cost = assumptions.nurseCostPerHour == null ? "nurse cost" : `$${assumptions.nurseCostPerHour}`;
    return `${volume} × ${NURSE_REVIEW_MINUTES} min × (1 − ${now}) × ${cost} × 12`;
  }
  if (metric.id === "coord_minutes") {
    const cost = assumptions.coordCostPerHour == null ? "no coordinator cost" : `$${assumptions.coordCostPerHour}`;
    return `${volume} × (${base} − ${now}) ÷ 60 × ${cost} × 12`;
  }
  if (metric.id === "lost_scan_rate" || metric.id === "wrong_not_needed") {
    const scan = assumptions.revenuePerScan == null ? "revenue per scan" : `$${assumptions.revenuePerScan}`;
    return `${volume} × (${base} − ${now}) × ${scan} × 12`;
  }
  if (metric.id === "denial_rate") {
    return `${volume} × (11% − ${now}) × ${DENIAL_MINUTES} min × 12`;
  }
  return metric.formula;
}

export function exactMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

export function windowCopy(weeks: number[], partial: boolean): string {
  if (weeks.length === 0) return "";
  const a = weeks[0];
  const b = weeks[weeks.length - 1];
  if (partial && weeks.length === 1) return `Through W${a}`;
  return a === b ? `W${a}` : `W${a}–W${b}`;
}

export function guardrailCopy(metric: MetricDef, current: number, baseline: number | null): string {
  const now = formatMetric(metric, current);
  if (metric.summary === "matched" && baseline != null) {
    return `${metric.name} ${now} vs ${formatMetric(metric, baseline)} matched baseline`;
  }
  return `${metric.name} ${now} (target ${metric.targetDetail})`;
}

function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function signed(n: number): string {
  if (Math.abs(n) < 0.05) return "0";
  const rounded = Math.round(Math.abs(n) * 10) / 10;
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${n > 0 ? "+" : "−"}${body}`;
}

/**
 * The only source of metric definitions for the pilot impact page.
 * Popovers, chart labels, reference lines and dollar math all read from here.
 */

export type MetricId =
  | "north_star"
  | "nurse_touch"
  | "coord_minutes"
  | "lost_scan_rate"
  | "wrong_not_needed"
  | "denial_rate"
  | "spot_check"
  | "ai_ready_denial";

export type Direction = "higher" | "lower";
export type BaselineSource = "brief" | "assumption" | "measured";
export type Unit = "percent" | "minutes" | "hours";
export type BaselineMode = "fixed" | "measured" | "matched";
export type TargetMode = "value" | "half" | "none";
export type SeriesKey =
  | "northStar"
  | "nurseTouch"
  | "coordMinutes"
  | "lostScanRate"
  | "wrongNotNeeded"
  | "denialRate"
  | "aiReadyDenial"
  | "spotCheckAgreement";

export type LagKey = "wrongNotNeeded" | "denialRate" | "aiReadyDenial";

export interface Assumptions {
  nurseCostPerHour: number | null;
  coordCostPerHour: number | null;
  revenuePerScan: number | null;
  requestsPerMonth: number | null;
}

export interface ValueInput {
  current: number;
  baseline: number | null;
  /** Request count for the period being priced (one week, or one month). */
  requests: number;
  assumptions: Assumptions;
}

/** Dollars and hours for `requests`, not annualized. Null dollars means the lever is not priced. */
export interface ValueOutput {
  dollars: number | null;
  hours: number | null;
}

/** Fields the info popover reads. Impact metrics and the operations scorecard share this shape. */
export interface MetricSpec {
  name: string;
  definition: string;
  formula: string;
  baselineSource: BaselineSource;
  baselineMode: BaselineMode;
  /** Used when baselineMode is "fixed". */
  baseline: number | null;
  baselineDetail: string;
  targetMode: TargetMode;
  /** Used when targetMode is "value". */
  target: number | null;
  /** Words for a target that is not a single chart line, e.g. "Set after the first phase." */
  targetDetail: string;
  direction: Direction;
  unit: Unit;
  whyItMatters: string;
}

export interface MetricDef extends MetricSpec {
  id: MetricId;
  series: SeriesKey;
  /** Shown when the latest weeks are left out of the headline. */
  lagNote: string | null;
  lag: LagKey | null;
  counterfactual?: { key: "northStarWouldHave"; label: string };
  /** Extra band drawn behind the series. Not the metric's own baseline. */
  band?: { low: "matchedBaselineLow"; high: "matchedBaselineHigh"; label: string };
  /** Weekly field used as the baseline when baselineMode is "matched". */
  matchedKey?: "matchedBaselineDenial";
  /** Where a guardrail turns red. */
  breach?: "under-target" | "over-baseline";
  /** Sentence shape for the guardrail line under the north star. */
  summary?: "target" | "matched";
  /** Name on the value stack. Absent when the metric is not a dollar lever. */
  lever: string | null;
  role: "north" | "card" | "guardrail";
  value: (input: ValueInput) => ValueOutput;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  higher: "Higher is better",
  lower: "Lower is better",
};

export const SOURCE_LABEL: Record<BaselineSource, string> = {
  brief: "Brief",
  assumption: "Assumption",
  measured: "Measured in Shadow",
};

export const NEEDS_DATA_LABEL = "Needs Halcyon data";

const none: ValueOutput = { dollars: null, hours: null };

export const METRICS: { [K in MetricId]: MetricDef } = {
  north_star: {
    id: "north_star",
    name: "Same-day, no-nurse submissions",
    definition:
      "Routine approval-required requests submitted to the insurer the same business day as the order, with no nurse review, divided by all routine approval-required requests.",
    formula: "Same-day submissions with no nurse review ÷ routine approval-required requests.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 0,
    baselineDetail: "100% of requests are read by a nurse.",
    targetMode: "value",
    target: 0.7,
    targetDetail: "70%.",
    direction: "higher",
    unit: "percent",
    whyItMatters: "No dollars of its own. It drives nurse time, coordinator time and lost scans.",
    series: "northStar",
    lagNote: null,
    lag: null,
    counterfactual: { key: "northStarWouldHave", label: "Would have" },
    lever: null,
    role: "north",
    value: () => none,
  },
  nurse_touch: {
    id: "nurse_touch",
    name: "Nurse touch rate",
    definition: "Requests a nurse opened, for a clinical review or a spot-check, divided by approval-required requests.",
    formula: "Requests a nurse opened ÷ approval-required requests.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 1,
    baselineDetail: "18 min per review.",
    targetMode: "value",
    target: 0.3,
    targetDetail: "Under 30%.",
    direction: "lower",
    unit: "percent",
    whyItMatters:
      "Hours saved per month = requests × 18/60 × (1 − rate). Dollars per year = those hours × 12 × the nurse cost.",
    series: "nurseTouch",
    lagNote: null,
    lag: null,
    lever: "Nurse time",
    role: "card",
    value: ({ current, requests, assumptions }) => {
      const hours = requests * (18 / 60) * (1 - current);
      return {
        hours,
        dollars: assumptions.nurseCostPerHour == null ? null : hours * assumptions.nurseCostPerHour,
      };
    },
  },
  coord_minutes: {
    id: "coord_minutes",
    name: "Coordinator minutes per request",
    definition: "Hands-on coordinator minutes per approval-required request, including status checks.",
    formula: "Coordinator minutes ÷ approval-required requests.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 18,
    baselineDetail: "Receive 3, check 4, gather 6, submit 5. Status checks are 2 min each and the count is not measured.",
    targetMode: "none",
    target: null,
    targetDetail: "Set after Shadow.",
    direction: "lower",
    unit: "minutes",
    whyItMatters: "Hours saved per month = requests × (18 − current) / 60. Dollars only if a coordinator cost is set.",
    series: "coordMinutes",
    lagNote: null,
    lag: null,
    lever: "Coordinator time",
    role: "card",
    value: ({ current, baseline, requests, assumptions }) => {
      if (baseline == null) return none;
      const hours = (requests * (baseline - current)) / 60;
      return {
        hours,
        dollars: assumptions.coordCostPerHour == null ? null : hours * assumptions.coordCostPerHour,
      };
    },
  },
  lost_scan_rate: {
    id: "lost_scan_rate",
    name: "Lost-scan rate",
    definition:
      "Approval-required scans cancelled, moved or unpaid because approval was not in hand before the slot, divided by approval-required scans with a slot.",
    formula: "Lost scans ÷ approval-required scans with a slot.",
    baselineSource: "measured",
    baselineMode: "measured",
    baseline: null,
    baselineDetail: "Shadow weeks 0–2. Not in the brief.",
    targetMode: "half",
    target: null,
    targetDetail: "Half the baseline.",
    direction: "lower",
    unit: "percent",
    whyItMatters:
      "Scans recovered per month = requests × (baseline − current). Dollars per year = scans × 12 × revenue per scan.",
    series: "lostScanRate",
    lagNote: null,
    lag: null,
    lever: "Lost scans recovered",
    role: "card",
    value: ({ current, baseline, requests, assumptions }) => {
      if (baseline == null || assumptions.revenuePerScan == null) return none;
      return { dollars: requests * (baseline - current) * assumptions.revenuePerScan, hours: null };
    },
  },
  wrong_not_needed: {
    id: "wrong_not_needed",
    name: "Wrong \u201cno approval needed\u201d calls",
    definition:
      "Orders closed as no approval needed whose claim was later denied for missing approval, divided by orders checked.",
    formula: "Denied for missing approval ÷ orders checked.",
    baselineSource: "measured",
    baselineMode: "measured",
    baseline: null,
    baselineDetail:
      "The brief says 5% of these calls are wrong, in either direction. This rate is measured in Shadow weeks 0–2.",
    targetMode: "value",
    target: 0,
    targetDetail: "0%.",
    direction: "lower",
    unit: "percent",
    whyItMatters:
      "Dollars per year = requests × (baseline − current) × 12 × revenue per scan. Claim denials arrive weeks later, so the latest weeks are incomplete.",
    series: "wrongNotNeeded",
    lagNote: "Latest weeks are incomplete.",
    lag: "wrongNotNeeded",
    lever: "Unpaid scans avoided",
    role: "card",
    value: ({ current, baseline, requests, assumptions }) => {
      if (baseline == null || assumptions.revenuePerScan == null) return none;
      return { dollars: requests * (baseline - current) * assumptions.revenuePerScan, hours: null };
    },
  },
  denial_rate: {
    id: "denial_rate",
    name: "Denial rate",
    definition: "Denied requests divided by decided requests.",
    formula: "Denied ÷ decided requests.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 0.11,
    baselineDetail: "25 min of nurse and doctor time per denial.",
    targetMode: "value",
    target: 0.11,
    targetDetail: "Below 11%.",
    direction: "lower",
    unit: "percent",
    whyItMatters:
      "Hours saved per month = requests × (baseline − current) × 25/60. Insurer decisions take days, so the latest weeks are incomplete.",
    series: "denialRate",
    lagNote: "Latest weeks are incomplete.",
    lag: "denialRate",
    band: { low: "matchedBaselineLow", high: "matchedBaselineHigh", label: "Matched baseline" },
    lever: "Denials avoided",
    role: "card",
    value: ({ current, baseline, requests }) => {
      if (baseline == null) return none;
      // Nurse and doctor time share one clock. There is no blended cost, so this stays in hours.
      return { dollars: null, hours: requests * (baseline - current) * (25 / 60) };
    },
  },
  spot_check: {
    id: "spot_check",
    name: "Spot-check agreement",
    definition: "AI submissions in the spot-check sample that the nurse agreed with, divided by submissions checked.",
    formula: "Agreed spot-checks ÷ spot-checks.",
    baselineSource: "measured",
    baselineMode: "measured",
    baseline: null,
    baselineDetail: "Agreement across Shadow weeks 0–2.",
    targetMode: "value",
    target: 0.95,
    targetDetail: "≥ 95%",
    direction: "higher",
    unit: "percent",
    whyItMatters: "The guardrail on skipping nurse review. Below 95%, the sample says a nurse still needs to see the work.",
    series: "spotCheckAgreement",
    lagNote: null,
    lag: null,
    breach: "under-target",
    summary: "target",
    lever: null,
    role: "guardrail",
    value: () => none,
  },
  ai_ready_denial: {
    id: "ai_ready_denial",
    name: "Denials on AI-ready requests",
    definition:
      "Denied divided by decided, among requests the model marked ready for submission, compared with similar requests that were not.",
    formula: "AI-ready denials ÷ AI-ready decisions.",
    baselineSource: "measured",
    baselineMode: "matched",
    baseline: null,
    baselineDetail: "Matched baseline of similar requests, measured in Shadow and carried forward.",
    targetMode: "none",
    target: null,
    targetDetail: "At or below the matched baseline.",
    direction: "lower",
    unit: "percent",
    whyItMatters: "A rate above the matched baseline means auto-submit is denied more often than similar requests a person reviewed.",
    series: "aiReadyDenial",
    lagNote: "Latest weeks are incomplete.",
    lag: "aiReadyDenial",
    matchedKey: "matchedBaselineDenial",
    breach: "over-baseline",
    summary: "matched",
    lever: null,
    role: "guardrail",
    value: () => none,
  },
};

export const CARD_IDS: MetricId[] = [
  "nurse_touch",
  "coord_minutes",
  "lost_scan_rate",
  "wrong_not_needed",
  "denial_rate",
];

export const GUARDRAIL_IDS: MetricId[] = ["spot_check", "ai_ready_denial"];

export const LEVER_IDS: MetricId[] = [
  "nurse_touch",
  "coord_minutes",
  "lost_scan_rate",
  "wrong_not_needed",
  "denial_rate",
];

export type InputSource = "assumption" | "halcyon";

export const INPUT_SOURCE_LABEL: Record<InputSource, string> = {
  assumption: "Assumption",
  halcyon: "Halcyon data",
};

export interface AssumptionField {
  key: keyof Assumptions;
  label: string;
  source: InputSource;
  prefix: string;
}

export const ASSUMPTION_FIELDS: AssumptionField[] = [
  { key: "nurseCostPerHour", label: "Nurse cost per hour", source: "assumption", prefix: "$" },
  { key: "coordCostPerHour", label: "Coordinator cost per hour", source: "halcyon", prefix: "$" },
  { key: "revenuePerScan", label: "Net revenue per scan", source: "assumption", prefix: "$" },
  { key: "requestsPerMonth", label: "Approval requests per month", source: "halcyon", prefix: "" },
];

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  nurseCostPerHour: 62,
  coordCostPerHour: null,
  revenuePerScan: 800,
  requestsPerMonth: 12000,
};

/**
 * Operations scorecard metrics. Spot-check agreement stays on METRICS.spot_check
 * so the target and the definition are the same object the Impact page reads.
 */
export const OPS_METRICS = {
  no_nurse_submit: {
    name: "Submitted without a nurse touch",
    definition:
      "Share of routine approval-required requests submitted to the insurer with no nurse review.",
    formula: "Routine approval-required requests submitted with no nurse review ÷ routine approval-required requests submitted.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 0,
    baselineDetail: "Nurses submit every request.",
    targetMode: "value",
    target: 0.5,
    targetDetail: "≥ 50% of routine MRI and CT.",
    direction: "higher",
    unit: "percent",
    whyItMatters: "The share that never waits on a nurse.",
  },
  order_to_submit: {
    name: "Median order to submitted",
    definition: "Median business hours from the order arriving to the request reaching the insurer.",
    formula: "Median of submitted time minus order time, in business hours.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 18,
    baselineDetail: "About 1 to 2 business days.",
    targetMode: "value",
    target: 9,
    targetDetail: "Same business day.",
    direction: "lower",
    unit: "hours",
    whyItMatters: "Same-day submission is the point of the pipeline.",
  },
  intake_catch: {
    name: "Missing documents caught at intake",
    definition: "Share of all missing items found before any nurse review.",
    formula: "Missing items caught at intake ÷ missing items.",
    baselineSource: "brief",
    baselineMode: "fixed",
    baseline: 0,
    baselineDetail: "Found at nurse review.",
    targetMode: "value",
    target: 0.9,
    targetDetail: "≥ 90%.",
    direction: "higher",
    unit: "percent",
    whyItMatters: "A missing note found at intake does not wait a day in the nurse queue.",
  },
  overturned: {
    name: "Auto-submits overturned",
    definition:
      "AI-ready cases later sent back by a nurse, or denied for a reason the rules should have caught, divided by AI-ready submissions.",
    formula: "Overturned auto-submits ÷ AI-ready submissions.",
    baselineSource: "measured",
    baselineMode: "measured",
    baseline: null,
    baselineDetail: "No auto-submits before the pilot.",
    targetMode: "value",
    target: 0.01,
    targetDetail: "< 1%.",
    direction: "lower",
    unit: "percent",
    whyItMatters: "Guardrail on skipping nurse review. Above 1%, a nurse still has to see the work.",
  },
  decision_time: {
    name: "Median insurer decision time",
    definition: "Median clock hours from submission to the insurer's decision.",
    formula: "Median of decision time minus submitted time.",
    baselineSource: "assumption",
    baselineMode: "measured",
    baseline: null,
    baselineDetail: "Not in the brief. Measured once decisions land.",
    targetMode: "none",
    target: null,
    targetDetail: "No target set.",
    direction: "lower",
    unit: "hours",
    whyItMatters: "A slow insurer is why a slot slips, even when our side is fast.",
  },
} as const satisfies Record<string, MetricSpec>;

/** Terms the operations page explains with the same info control. Not chart series. */
export const CONCEPTS = {
  past_due: {
    name: "Past due",
    definition:
      "A case whose task due time or latest submit time has passed, in business hours. The task is due when the status time limit runs out. The latest submit time is the scan minus the insurer's usual decision time.",
  },
  slot_at_risk: {
    name: "Slot at risk",
    definition: "No approval, and the insurer's typical decision time would land after the slot.",
  },
  age: {
    name: "Age",
    definition:
      "Business hours since the case entered its current status. Business hours are weekdays from 8:00 to 5:00. The bar splits under 4 hours, 4 to 24 hours, and over 24 hours.",
  },
} as const;

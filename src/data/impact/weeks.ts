/**
 * ILLUSTRATIVE pilot series. Not Halcyon production data.
 * Thirteen weeks, W0–W12. Trends follow the brief, with small week-to-week noise.
 * Shadow weeks sit on the brief's baselines. Improvement starts in Assisted.
 * Volume is one hospital (~200/week) until Expand, then ramps toward the network.
 */

import type { LagKey, SeriesKey } from "@/data/impact/metrics";

export const ILLUSTRATIVE = true;

export type Phase = "shadowWeeks" | "assisted" | "expand";

export interface WeekRow {
  week: number;
  phase: Phase;
  /** Approval-required requests across the hospitals in the pilot that week. */
  requests: number;
  /** Requests at the original pilot hospital only. */
  pilotRequests: number;
  northStar: number;
  northStarWouldHave: number;
  nurseTouch: number;
  coordMinutes: number;
  lostScanRate: number;
  wrongNotNeeded: number;
  denialRate: number;
  aiReadyDenial: number;
  matchedBaselineDenial: number;
  matchedBaselineLow: number;
  matchedBaselineHigh: number;
  spotCheckAgreement: number;
  incomplete: Record<LagKey, boolean>;
  n: Record<SeriesKey, number>;
}

export const PHASES: { id: Phase; label: string; from: number; to: number; note: string }[] = [
  { id: "shadowWeeks", label: "Shadow", from: 0, to: 2, note: "Weeks 0–2. Nurses review every request." },
  { id: "assisted", label: "Assisted", from: 3, to: 6, note: "Weeks 3–6. Same-day submission starts." },
  { id: "expand", label: "Expand", from: 7, to: 12, note: "Weeks 7–12. More hospitals join." },
];

export const WEEK_MIN = 0;
export const WEEK_MAX = 12;
/** Shared by every chart so the weeks line up. */
export const WEEK_TICKS = [0, 2, 4, 6, 8, 10, 12];

interface Seed {
  week: number;
  phase: Phase;
  requests: number;
  pilotRequests: number;
  northStar: number;
  northStarWouldHave: number;
  nurseTouch: number;
  coordMinutes: number;
  lostScanRate: number;
  wrongNotNeeded: number;
  denialRate: number;
  aiReadyDenial: number;
  matchedBaselineDenial: number;
  matchedBaselineLow: number;
  matchedBaselineHigh: number;
  spotCheckAgreement: number;
}

const SEED: Seed[] = [
  // Shadow: nurses still review everything. North star is 0. "Would have" is the AI-ready share they agreed with.
  { week: 0, phase: "shadowWeeks", requests: 192, pilotRequests: 192, northStar: 0, northStarWouldHave: 0.48, nurseTouch: 1, coordMinutes: 18, lostScanRate: 0.041, wrongNotNeeded: 0.021, denialRate: 0.11, aiReadyDenial: 0.049, matchedBaselineDenial: 0.056, matchedBaselineLow: 0.051, matchedBaselineHigh: 0.061, spotCheckAgreement: 0.92 },
  { week: 1, phase: "shadowWeeks", requests: 208, pilotRequests: 208, northStar: 0, northStarWouldHave: 0.51, nurseTouch: 1, coordMinutes: 18, lostScanRate: 0.039, wrongNotNeeded: 0.019, denialRate: 0.11, aiReadyDenial: 0.044, matchedBaselineDenial: 0.06, matchedBaselineLow: 0.054, matchedBaselineHigh: 0.066, spotCheckAgreement: 0.924 },
  { week: 2, phase: "shadowWeeks", requests: 186, pilotRequests: 186, northStar: 0, northStarWouldHave: 0.49, nurseTouch: 1, coordMinutes: 18, lostScanRate: 0.042, wrongNotNeeded: 0.022, denialRate: 0.11, aiReadyDenial: 0.051, matchedBaselineDenial: 0.055, matchedBaselineLow: 0.05, matchedBaselineHigh: 0.06, spotCheckAgreement: 0.918 },
  // Assisted: same-day submission starts, touch rate falls, minutes fall.
  { week: 3, phase: "assisted", requests: 204, pilotRequests: 204, northStar: 0.08, northStarWouldHave: 0.52, nurseTouch: 0.9, coordMinutes: 16.4, lostScanRate: 0.038, wrongNotNeeded: 0.018, denialRate: 0.107, aiReadyDenial: 0.046, matchedBaselineDenial: 0.058, matchedBaselineLow: 0.052, matchedBaselineHigh: 0.064, spotCheckAgreement: 0.934 },
  { week: 4, phase: "assisted", requests: 196, pilotRequests: 196, northStar: 0.14, northStarWouldHave: 0.54, nurseTouch: 0.81, coordMinutes: 15.1, lostScanRate: 0.036, wrongNotNeeded: 0.017, denialRate: 0.104, aiReadyDenial: 0.043, matchedBaselineDenial: 0.057, matchedBaselineLow: 0.051, matchedBaselineHigh: 0.063, spotCheckAgreement: 0.941 },
  { week: 5, phase: "assisted", requests: 218, pilotRequests: 218, northStar: 0.21, northStarWouldHave: 0.55, nurseTouch: 0.72, coordMinutes: 13.4, lostScanRate: 0.034, wrongNotNeeded: 0.015, denialRate: 0.1, aiReadyDenial: 0.041, matchedBaselineDenial: 0.059, matchedBaselineLow: 0.053, matchedBaselineHigh: 0.065, spotCheckAgreement: 0.947 },
  { week: 6, phase: "assisted", requests: 201, pilotRequests: 201, northStar: 0.31, northStarWouldHave: 0.57, nurseTouch: 0.6, coordMinutes: 11.6, lostScanRate: 0.031, wrongNotNeeded: 0.013, denialRate: 0.096, aiReadyDenial: 0.037, matchedBaselineDenial: 0.056, matchedBaselineLow: 0.05, matchedBaselineHigh: 0.062, spotCheckAgreement: 0.952 },
  // Expand: more hospitals. Rates keep improving; volume jumps.
  { week: 7, phase: "expand", requests: 720, pilotRequests: 207, northStar: 0.38, northStarWouldHave: 0.58, nurseTouch: 0.53, coordMinutes: 10.2, lostScanRate: 0.029, wrongNotNeeded: 0.011, denialRate: 0.093, aiReadyDenial: 0.036, matchedBaselineDenial: 0.058, matchedBaselineLow: 0.052, matchedBaselineHigh: 0.064, spotCheckAgreement: 0.957 },
  { week: 8, phase: "expand", requests: 1680, pilotRequests: 194, northStar: 0.45, northStarWouldHave: 0.6, nurseTouch: 0.47, coordMinutes: 9, lostScanRate: 0.026, wrongNotNeeded: 0.009, denialRate: 0.089, aiReadyDenial: 0.034, matchedBaselineDenial: 0.055, matchedBaselineLow: 0.05, matchedBaselineHigh: 0.06, spotCheckAgreement: 0.962 },
  { week: 9, phase: "expand", requests: 2720, pilotRequests: 211, northStar: 0.51, northStarWouldHave: 0.61, nurseTouch: 0.42, coordMinutes: 8.2, lostScanRate: 0.024, wrongNotNeeded: 0.008, denialRate: 0.086, aiReadyDenial: 0.033, matchedBaselineDenial: 0.057, matchedBaselineLow: 0.051, matchedBaselineHigh: 0.063, spotCheckAgreement: 0.966 },
  { week: 10, phase: "expand", requests: 2755, pilotRequests: 189, northStar: 0.55, northStarWouldHave: 0.62, nurseTouch: 0.39, coordMinutes: 7.6, lostScanRate: 0.023, wrongNotNeeded: 0.006, denialRate: 0.083, aiReadyDenial: 0.031, matchedBaselineDenial: 0.058, matchedBaselineLow: 0.052, matchedBaselineHigh: 0.064, spotCheckAgreement: 0.97 },
  { week: 11, phase: "expand", requests: 2795, pilotRequests: 216, northStar: 0.58, northStarWouldHave: 0.63, nurseTouch: 0.37, coordMinutes: 7.2, lostScanRate: 0.021, wrongNotNeeded: 0.004, denialRate: 0.081, aiReadyDenial: 0.029, matchedBaselineDenial: 0.056, matchedBaselineLow: 0.051, matchedBaselineHigh: 0.061, spotCheckAgreement: 0.968 },
  { week: 12, phase: "expand", requests: 2770, pilotRequests: 203, northStar: 0.6, northStarWouldHave: 0.64, nurseTouch: 0.35, coordMinutes: 6.8, lostScanRate: 0.02, wrongNotNeeded: 0.003, denialRate: 0.078, aiReadyDenial: 0.028, matchedBaselineDenial: 0.057, matchedBaselineLow: 0.052, matchedBaselineHigh: 0.062, spotCheckAgreement: 0.96 },
];

function sampleSize(seed: Seed): Record<SeriesKey, number> {
  const r = seed.requests;
  const wrongLate = seed.week >= 10;
  const denialLate = seed.week >= 11;
  return {
    northStar: r,
    nurseTouch: r,
    coordMinutes: r,
    lostScanRate: Math.round(r * 0.82),
    wrongNotNeeded: Math.round(r * (wrongLate ? 0.08 : 0.22)),
    denialRate: Math.round(r * (denialLate ? 0.34 : 0.91)),
    aiReadyDenial: Math.round(r * (denialLate ? 0.12 : 0.28)),
    spotCheckAgreement: Math.max(12, Math.round(r * (seed.week < 4 ? 0.2 : 0.07))),
  };
}

export const WEEKS: WeekRow[] = SEED.map((seed) => ({
  ...seed,
  // Claim denials lag the work. Wrong-call outcomes lag three weeks; insurer decisions lag two.
  incomplete: {
    wrongNotNeeded: seed.week >= 10,
    denialRate: seed.week >= 11,
    aiReadyDenial: seed.week >= 11,
  },
  n: sampleSize(seed),
}));

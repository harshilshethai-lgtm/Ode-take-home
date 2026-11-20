import { HOSPITAL } from "@/data/operations/queue";
import { configFor } from "@/domain/insurer/config";
import { addBusinessHours } from "@/domain/operations/time";
import { DEMO_NOW, demoDateKey, parseDemoInstant } from "@/lib/demoClock";

/**
 * Illustrative completed requests for the eight weeks ending on the demo clock.
 * The open queue is the worklist seed, not this list. Rates on the scorecard are
 * counts over these cases. Week 7 is the reporting week (the seven days ending Monday Nov 9).
 */

export interface ThroughputCase {
  id: string;
  hospital: string;
  insurer: string;
  /** 0 is the oldest week, 7 is the reporting week. */
  weekIndex: number;
  orderedAt: Date;
  submittedAt: Date;
  decidedAt: Date;
  nurseTouched: boolean;
  missingItems: number;
  caughtAtIntake: number;
  spot: "agree" | "disagree" | null;
  overturned: boolean;
  aiReadyDenied: boolean;
}

interface WeekShape {
  requests: number;
  noNurse: number;
  /** Cases ordered on the demo day. Zero outside the reporting week. */
  today: number;
  submitHours: number;
  missingItems: number;
  caught: number;
  spotChecks: number;
  spotAgrees: number;
  overturned: number;
  denied: number;
  decisionHours: number;
}

interface StartShape {
  requests: number;
  noNurseRate: number;
  submitHours: number;
  missingRate: number;
  catchRate: number;
  spotRate: number;
  agreeRate: number;
  denialRate: number;
  decisionHours: number;
}

interface InsurerPlan {
  insurer: string;
  matchedBaseline: number;
  current: WeekShape;
  start: StartShape;
}

const PLANS: InsurerPlan[] = [
  {
    insurer: "Federation Health",
    matchedBaseline: 0.058,
    current: {
      requests: 28,
      noNurse: 17,
      today: 8,
      submitHours: 5,
      missingItems: 8,
      caught: 8,
      spotChecks: 6,
      spotAgrees: 6,
      overturned: 0,
      denied: 0,
      decisionHours: 18,
    },
    start: shadow(20, 0.058),
  },
  {
    insurer: "Ferengi Benefit Group",
    matchedBaseline: 0.058,
    current: {
      requests: 16,
      noNurse: 6,
      today: 0,
      submitHours: 14,
      missingItems: 9,
      caught: 5,
      spotChecks: 4,
      spotAgrees: 3,
      overturned: 0,
      denied: 1,
      decisionHours: 70,
    },
    start: shadow(12, 0.058),
  },
  {
    insurer: "Andorian Life",
    matchedBaseline: 0.055,
    current: {
      requests: 12,
      noNurse: 4,
      today: 0,
      submitHours: 9,
      missingItems: 5,
      caught: 5,
      spotChecks: 3,
      spotAgrees: 3,
      overturned: 0,
      denied: 0,
      decisionHours: 40,
    },
    start: shadow(8, 0.055),
  },
  {
    insurer: "Vulcan Science Mutual",
    matchedBaseline: 0.05,
    current: {
      requests: 10,
      noNurse: 6,
      today: 3,
      submitHours: 6,
      missingItems: 3,
      caught: 3,
      spotChecks: 3,
      spotAgrees: 3,
      overturned: 0,
      denied: 0,
      decisionHours: 22,
    },
    start: shadow(8, 0.05),
  },
  {
    insurer: "Klingon Assurance",
    matchedBaseline: 0.06,
    current: {
      requests: 8,
      noNurse: 4,
      today: 2,
      submitHours: 7,
      missingItems: 2,
      caught: 2,
      spotChecks: 2,
      spotAgrees: 2,
      overturned: 0,
      denied: 0,
      decisionHours: 30,
    },
    start: shadow(6, 0.06),
  },
  {
    insurer: "Bajoran Health Plan",
    matchedBaseline: 0.052,
    current: {
      requests: 6,
      noNurse: 1,
      today: 2,
      submitHours: 8,
      missingItems: 2,
      caught: 1,
      spotChecks: 2,
      spotAgrees: 2,
      overturned: 0,
      denied: 0,
      decisionHours: 26,
    },
    start: shadow(4, 0.052),
  },
];

function shadow(requests: number, denialRate: number): StartShape {
  return {
    requests,
    noNurseRate: 0.05,
    submitHours: 16,
    missingRate: 0.4,
    catchRate: 0.15,
    spotRate: 0.2,
    agreeRate: 0.9,
    denialRate,
    decisionHours: 48,
  };
}

export const MATCHED_BASELINE: Record<string, number> = Object.fromEntries(
  PLANS.map((plan) => [plan.insurer, plan.matchedBaseline]),
);

/** Median hours from submission to a decision, from the insurer table. */
export function medianDecisionHours(insurer: string | null): number {
  if (!insurer) return 48;
  try {
    return configFor(insurer).medianDecisionHours;
  } catch {
    return 48;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function shapeAt(plan: InsurerPlan, weekIndex: number): WeekShape {
  if (weekIndex === 7) return plan.current;
  const t = weekIndex / 7;
  const end = plan.current;
  const start = plan.start;
  const requests = Math.max(1, clamp(lerp(start.requests, end.requests, t), 1, 10000));
  const noNurse = clamp(requests * lerp(start.noNurseRate, end.noNurse / end.requests, t), 0, requests);
  const missingItems = clamp(requests * lerp(start.missingRate, end.missingItems / end.requests, t), 0, requests * 3);
  const caught = clamp(missingItems * lerp(start.catchRate, end.missingItems === 0 ? 0 : end.caught / end.missingItems, t), 0, missingItems);
  const spotChecks = clamp(requests * lerp(start.spotRate, end.spotChecks / end.requests, t), 0, requests);
  const spotAgrees = clamp(spotChecks * lerp(start.agreeRate, end.spotChecks === 0 ? 1 : end.spotAgrees / end.spotChecks, t), 0, spotChecks);
  const denied = clamp(noNurse * lerp(start.denialRate, end.noNurse === 0 ? 0 : end.denied / end.noNurse, t), 0, noNurse);
  return {
    requests,
    noNurse,
    today: 0,
    submitHours: lerp(start.submitHours, end.submitHours, t),
    missingItems,
    caught,
    spotChecks,
    spotAgrees,
    overturned: 0,
    denied,
    decisionHours: lerp(start.decisionHours, end.decisionHours, t),
  };
}

/** Wednesday 10:00 Eastern of the week of Nov 4, then one week earlier per step. */
function weekWednesday(weeksAgo: number): Date {
  const date = parseDemoInstant("2026-11-04T10:00:00");
  return new Date(date.getTime() - weeksAgo * 7 * 24 * 36e5);
}

/** Morning of the demo day, so "today" on the scorecard is the clock's day. */
const DEMO_MORNING = parseDemoInstant(`${demoDateKey(DEMO_NOW)}T08:00:00`);

function buildInsurer(plan: InsurerPlan): ThroughputCase[] {
  const out: ThroughputCase[] = [];
  for (let weekIndex = 0; weekIndex < 8; weekIndex += 1) {
    const shape = shapeAt(plan, weekIndex);
    const slug = plan.insurer.toLowerCase().replace(/[^a-z]+/g, "-");
    const cases: ThroughputCase[] = [];
    for (let i = 0; i < shape.requests; i += 1) {
      const onToday = weekIndex === 7 && i < shape.today;
      const orderedAt = onToday ? new Date(DEMO_MORNING) : weekWednesday(7 - weekIndex);
      const submittedAt = addBusinessHours(orderedAt, shape.submitHours);
      const decidedAt = new Date(submittedAt.getTime() + shape.decisionHours * 36e5);
      cases.push({
        id: `${slug}-${weekIndex}-${i}`,
        hospital: HOSPITAL,
        insurer: plan.insurer,
        weekIndex,
        orderedAt,
        submittedAt,
        decidedAt,
        nurseTouched: i >= shape.noNurse,
        missingItems: 0,
        caughtAtIntake: 0,
        spot: null,
        overturned: false,
        aiReadyDenied: false,
      });
    }
    for (let k = 0; k < shape.missingItems; k += 1) {
      const item = cases[k % cases.length];
      item.missingItems += 1;
      if (k < shape.caught) item.caughtAtIntake += 1;
    }
    for (let k = 0; k < shape.spotChecks; k += 1) {
      cases[k].spot = k < shape.spotAgrees ? "agree" : "disagree";
    }
    for (let k = 0; k < shape.overturned; k += 1) cases[k].overturned = true;
    for (let k = 0; k < shape.denied; k += 1) cases[shape.noNurse - 1 - k].aiReadyDenied = true;
    out.push(...cases);
  }
  return out;
}

export const THROUGHPUT: ThroughputCase[] = PLANS.flatMap(buildInsurer);

// Golden-case runner. Runs the same test cases against any version (active, draft, old) without persisting.

import { buildSnapshot, evaluateSnapshot } from "./engine";
import type { CriterionStatus, EvaluationOutcome, OverallStatus, Payer, Policy, PolicyVersion, TestCase } from "./types";

export interface RunSide {
  versionId: string;
  versionNumber: number;
  overall: OverallStatus | "no_policy_found";
  criteria: Record<string, CriterionStatus>;
  submissionBlocked: boolean;
  passes: boolean;
  /** Plain-English reasons the expectation was not met. Empty when it passed. */
  failures: string[];
}

export interface TestRow {
  testCaseId: string;
  name: string;
  description: string;
  expected: TestCase["expected"];
  /** Result under the currently active version; undefined if the policy has none. */
  active?: RunSide;
  candidate: RunSide;
  /** Did the candidate behave differently from the active version (overall or any criterion)? */
  changed: boolean;
}

export interface TestRunResult {
  versionId: string;
  activeVersionId: string | null;
  rows: TestRow[];
  total: number;
  candidatePassing: number;
  candidateFailing: number;
  changedCount: number;
}

export function runOne(payer: Payer, policy: Policy, version: PolicyVersion, tc: TestCase): RunSide {
  const outcome: EvaluationOutcome = evaluateSnapshot(buildSnapshot(payer, policy, version), tc.input);
  const criteria = Object.fromEntries(outcome.criterionResults.map((r) => [r.criterionKey, r.status])) as Record<string, CriterionStatus>;
  const failures: string[] = [];
  if (outcome.overall !== tc.expected.overall) {
    failures.push(`Expected overall "${tc.expected.overall}" but got "${outcome.overall}".`);
  }
  for (const [key, want] of Object.entries(tc.expected.criteria ?? {})) {
    const got = criteria[key];
    if (got === undefined) failures.push(`Expected criterion "${key}" to be ${want}, but this version has no criterion "${key}".`);
    else if (got !== want) failures.push(`Expected "${key}" to be ${want} but got ${got}.`);
  }
  if (tc.expected.submissionBlocked !== undefined && tc.expected.submissionBlocked !== outcome.submissionBlocked) {
    failures.push(`Expected submissionBlocked=${tc.expected.submissionBlocked} but got ${outcome.submissionBlocked}.`);
  }
  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    overall: outcome.overall,
    criteria,
    submissionBlocked: outcome.submissionBlocked,
    passes: failures.length === 0,
    failures,
  };
}

function behavesDifferently(a: RunSide, b: RunSide): boolean {
  if (a.overall !== b.overall || a.submissionBlocked !== b.submissionBlocked) return true;
  const keys = new Set([...Object.keys(a.criteria), ...Object.keys(b.criteria)]);
  for (const k of keys) if (a.criteria[k] !== b.criteria[k]) return true;
  return false;
}

export function runTestCases(
  payer: Payer,
  policy: Policy,
  candidate: PolicyVersion,
  active: PolicyVersion | null,
  testCases: TestCase[],
): TestRunResult {
  const rows: TestRow[] = testCases.map((tc) => {
    const cand = runOne(payer, policy, candidate, tc);
    const act = active ? (active.id === candidate.id ? cand : runOne(payer, policy, active, tc)) : undefined;
    return {
      testCaseId: tc.id,
      name: tc.name,
      description: tc.description,
      expected: tc.expected,
      active: act,
      candidate: cand,
      changed: act ? behavesDifferently(act, cand) : false,
    };
  });
  return {
    versionId: candidate.id,
    activeVersionId: active?.id ?? null,
    rows,
    total: rows.length,
    candidatePassing: rows.filter((r) => r.candidate.passes).length,
    candidateFailing: rows.filter((r) => !r.candidate.passes).length,
    changedCount: rows.filter((r) => r.changed).length,
  };
}

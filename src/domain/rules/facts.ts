// The kinds of fact a property check can read. This is the engine's vocabulary, not a list of policy properties:
// policies define their own properties and point a check at one of these.

import { asRecord, bodySiteLabel, studyLabel } from "./common";
import type { EvaluationContext, Fact } from "./types";

export interface FactKind {
  id: string;
  /** Facts of one group share its filters (lookback, accepted sources, side). */
  group: string;
  match: (f: Fact, ctx: EvaluationContext) => boolean;
  /** How min_weeks measures: weeks since the earliest fact, or weeks covered by treatment intervals. */
  duration?: "since" | "covered";
  /** For absent: a fact type that proves the history was looked at. Silence is not proof. */
  proof?: string;
  /** Noun phrase for sentences: "conservative treatment", "lumbar spine MRI". */
  noun: (ctx: EvaluationContext) => string;
}

const imaging = (studyType: string): FactKind => ({
  id: studyType,
  group: studyType,
  match: (f, ctx) => {
    if (f.type !== "imaging_study") return false;
    const v = asRecord(f.value);
    return v.studyType === studyType && (!ctx.bodySite || v.bodySite === ctx.bodySite);
  },
  proof: "imaging_history_reviewed",
  noun: (ctx) => (ctx.bodySite ? `${bodySiteLabel(ctx.bodySite)} ${studyLabel(studyType)}` : studyLabel(studyType)),
});

export const FACT_KINDS: FactKind[] = [
  { id: "symptom_onset", group: "symptom_onset", match: (f) => f.type === "symptom_onset", duration: "since", noun: () => "symptom onset" },
  {
    id: "conservative_treatment",
    group: "conservative_treatment",
    match: (f) => f.type === "conservative_treatment",
    duration: "covered",
    noun: () => "conservative treatment",
  },
  {
    id: "treatment_response",
    group: "conservative_treatment",
    match: (f) => f.type === "conservative_treatment" && asRecord(f.value).responseDocumented === true,
    noun: () => "the patient's response to treatment",
  },
  imaging("xray"),
  imaging("mri"),
  imaging("ct"),
  { id: "imaging_history_reviewed", group: "imaging_history_reviewed", match: (f) => f.type === "imaging_history_reviewed", noun: () => "an imaging history review" },
];

export function getFactKind(id: string): FactKind | undefined {
  return FACT_KINDS.find((k) => k.id === id);
}

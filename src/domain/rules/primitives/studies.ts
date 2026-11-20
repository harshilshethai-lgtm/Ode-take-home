// Shared helpers for the imaging-study primitives.
// Fact convention: type "imaging_study", value { studyType, bodySite }, date = study date, laterality optional.

import { asRecord } from "../common";
import type { Fact, Laterality } from "../types";

export const STUDY_TYPES = ["xray", "mri", "ct", "ultrasound"] as const;

export function imagingStudies(facts: Fact[], studyType: string, bodySite: string): Fact[] {
  return facts.filter((f) => {
    if (f.type !== "imaging_study") return false;
    const v = asRecord(f.value);
    return v.studyType === studyType && v.bodySite === bodySite;
  });
}

export type SideMatch = "match" | "mismatch" | "unknown";

/** Same-side check. If either side is not documented we cannot say, and must not guess. */
export function sideMatch(factSide: Laterality | undefined, orderSide: Laterality | undefined): SideMatch {
  if (!factSide || !orderSide) return "unknown";
  if (factSide === "bilateral" || orderSide === "bilateral") return "match";
  return factSide === orderSide ? "match" : "mismatch";
}

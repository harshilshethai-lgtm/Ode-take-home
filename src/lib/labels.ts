// Human labels for every enum shown in the UI. This is the ONLY file where snake_case keys may sit next to
// display text (see scripts/design-lint.ts). Components call label(MAP, key) and never render a raw key.

import type { CriterionStatus, EvaluationOverall, SourceType } from "@/domain/rules/types";

/** Sentence-case fallback so an unmapped enum never shows underscores. */
export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function label(map: Readonly<Record<string, string>>, key: string | null | undefined): string {
  if (!key) return "";
  return map[key] ?? humanizeKey(key);
}

/* ------------------------------- Engine enums ------------------------------- */

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  pt_note: "PT note",
  clinic_note_treating_provider: "Clinic note",
  injection_record: "Injection record",
  pharmacy_record: "Med list",
  imaging_report: "Imaging report",
  patient_reported: "Patient-reported",
};

export const CRITERION_STATUS_LABEL: Record<CriterionStatus, string> = {
  met: "Met",
  not_met: "Not met",
  unknown: "Unknown",
  needs_review: "Needs review",
  waived: "Waived",
};

export const OVERALL_LABEL: Record<EvaluationOverall, string> = {
  approve_ready: "Approve ready",
  missing_info: "Missing info",
  not_eligible: "Not eligible",
  needs_review: "Needs review",
  no_policy_found: "No policy",
};

export const PLAN_TYPE_LABEL: Record<string, string> = {
  commercial_hmo: "Commercial HMO",
  commercial_ppo: "Commercial PPO",
  commercial_epo: "Commercial EPO",
  ppo: "PPO",
  epo: "EPO",
  hmo: "HMO",
  medicare_advantage: "Medicare Advantage",
  medicaid_managed_care: "Medicaid",
};

export const MODALITY_LABEL: Record<string, string> = {
  physical_therapy: "Physical therapy",
  chiropractic: "Chiropractic",
  prescription_medication: "Prescription meds",
  otc_medication: "OTC meds",
  home_exercise_program: "Home exercises",
  injection: "Injection",
};

export const FACT_TYPE_LABEL: Record<string, string> = {
  symptom_onset: "Symptom onset",
  conservative_treatment: "Conservative care",
  imaging_study: "Imaging",
  imaging_history_reviewed: "Imaging history",
  exception_trigger: "Red flag",
  exam_finding: "Exam finding",
  document_present: "Document",
};

export const CRITERION_KEY_LABEL: Record<string, string> = {
  symptom_duration: "Symptom duration",
  conservative_care: "Conservative care",
  prior_xray: "X-ray",
  no_recent_mri: "No recent MRI",
};

export const BODY_SITE_LABEL: Record<string, string> = {
  lumbar_spine: "Lumbar spine",
  knee: "Knee",
  shoulder: "Shoulder",
};

/* ------------------------------- Case layer ------------------------------- */

export const CASE_STATUS_LABEL: Record<string, string> = {
  ready_to_submit: "Ready to submit",
  hold_for_records: "Hold: records needed",
  return_to_provider: "Return to provider",
  nurse_review: "Nurse review",
};

export const CASE_STATUS_SHORT_LABEL: Record<string, string> = {
  ready_to_submit: "Ready",
  hold_for_records: "Hold",
  return_to_provider: "Return",
  nurse_review: "Nurse",
};

export const ISSUE_KIND_LABEL: Record<string, string> = {
  missing_pages: "Missing pages",
  referenced_absent: "Records not included",
  pending_records: "Records pending",
  conflict: "Conflict",
  low_confidence: "Low confidence",
  admin_missing: "Missing field",
};

export const CHECK_KIND_LABEL: Record<string, string> = {
  epic_eligibility: "Eligibility",
  epic_imaging_history: "Imaging history",
  policy_resolution: "Policy",
  rule_evaluation: "Rules",
  insurer_status: "Insurer status",
};

export const CHECK_STATUS_LABEL: Record<string, string> = { ok: "OK", failed: "Failed", stale: "Stale" };

export const EVENT_TYPE_LABEL: Record<string, string> = {
  received: "Received",
  ingested: "Read",
  extracted: "Extracted",
  external_check: "Check run",
  evaluated: "Evaluated",
  fact_corrected: "Corrected",
  status_changed: "Status changed",
  assigned: "Assigned",
  note_added: "Note added",
  submitted: "Submitted",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  fax_cover: "Fax cover",
  request_form: "Request form",
  office_note: "Office note",
  pt_note: "PT note",
  radiology_report: "Radiology report",
  med_list: "Med list",
  problem_list: "Problem list",
  imaging_history: "Imaging history",
  misc_notes: "Misc notes",
};

export const ORIGIN_LABEL: Record<string, string> = { pdf: "PDF", epic: "Epic", reviewer: "Edited" };

export const SIDE_SHORT: Record<string, string> = { Left: "L", Right: "R", Bilateral: "Both" };

/** Source names as written in the rule fixtures (plural, for "Accepts: ..." lists). */
export const RULE_SOURCE_LABEL: Record<string, string> = {
  pt_note: "PT notes",
  clinic_note: "Clinic notes",
  med_list: "Med list",
  patient_reported: "Patient-reported",
};

/** Short one-line form of each RAD-114 criterion ("2a  Symptoms ≥ 6 wks"). Presentation copy for the fixture. */
export const RULE_LINE: Record<string, string> = {
  "2a": "Symptoms ≥ 6 wks",
  "2b": "Conservative care ≥ 6 wks",
  "2c": "X-rays first",
  "2d": "No MRI in 12 mo",
};

export const FAIL_CLASS_LABEL: Record<string, string> = { clinical: "Clinical", documents: "Fixable" };

// Status table from PRD §Worklist → Statuses.

export type StatusGroup = "automated" | "coordinator" | "nurse" | "insurer" | "closed";

export type OwnerRole = "system" | "coordinator" | "nurse" | "rules_admin";

export type StatusId =
  | "received"
  | "pre_processing"
  | "unreadable"
  | "matching"
  | "unmatched"
  | "coverage_check"
  | "approval_check"
  | "collecting_evidence"
  | "awaiting_documents"
  | "needs_correction"
  | "evaluating"
  | "clinical_review"
  | "rule_gap"
  | "ready_to_submit"
  | "submitted"
  | "more_info_requested"
  | "approved"
  | "not_required"
  | "denied"
  | "appeal"
  | "closed_denied"
  | "cancelled";

export interface StatusDef {
  id: StatusId;
  label: string;
  group: StatusGroup;
  /** Default owner role. "ready_to_submit" depends on channel, see ownerRoleFor. */
  role: OwnerRole;
  meaning: string;
  /** Hours in this status before the row turns amber. null = no SLA (closed). */
  slaHours: number | null;
}

export const STATUSES: Record<StatusId, StatusDef> = {
  received: { id: "received", label: "Received", group: "automated", role: "system", meaning: "Order or document arrived", slaHours: 1 },
  pre_processing: { id: "pre_processing", label: "Pre-processing", group: "automated", role: "system", meaning: "Orientation, blank pages, page count, readability", slaHours: 1 },
  unreadable: { id: "unreadable", label: "Unreadable", group: "coordinator", role: "coordinator", meaning: "Blank, illegible or partial document", slaHours: 4 },
  matching: { id: "matching", label: "Matching", group: "automated", role: "system", meaning: "Match to patient and order", slaHours: 1 },
  unmatched: { id: "unmatched", label: "Unmatched", group: "coordinator", role: "coordinator", meaning: "No confident patient or order match", slaHours: 4 },
  coverage_check: { id: "coverage_check", label: "Coverage check", group: "automated", role: "system", meaning: "Eligibility and existing-approval lookup", slaHours: 1 },
  approval_check: { id: "approval_check", label: "Approval check", group: "automated", role: "system", meaning: "Rules decide: needed / not needed / unknown", slaHours: 1 },
  collecting_evidence: { id: "collecting_evidence", label: "Collecting evidence", group: "automated", role: "system", meaning: "Pull Epic records, request outside records, extract facts", slaHours: 2 },
  awaiting_documents: { id: "awaiting_documents", label: "Awaiting documents", group: "coordinator", role: "coordinator", meaning: "Request sent; waiting on a clinic or therapist", slaHours: 24 },
  needs_correction: { id: "needs_correction", label: "Needs correction", group: "coordinator", role: "coordinator", meaning: "Wrong side, wrong patient page, stale insurer, CPT conflict", slaHours: 4 },
  evaluating: { id: "evaluating", label: "Evaluating", group: "automated", role: "system", meaning: "Criteria and consistency checks", slaHours: 1 },
  clinical_review: { id: "clinical_review", label: "Clinical review", group: "nurse", role: "nurse", meaning: "Documents complete, criteria not met or not certain", slaHours: 4 },
  rule_gap: { id: "rule_gap", label: "Rule gap", group: "nurse", role: "nurse", meaning: "Approval needed, but no rules exist for this insurer + study", slaHours: 8 },
  ready_to_submit: { id: "ready_to_submit", label: "Ready to submit", group: "automated", role: "system", meaning: "Packet built; waiting to send", slaHours: 2 },
  submitted: { id: "submitted", label: "Submitted", group: "insurer", role: "system", meaning: "Sent, tracking number held", slaHours: 48 },
  more_info_requested: { id: "more_info_requested", label: "More info requested", group: "coordinator", role: "coordinator", meaning: "Insurer asked for more", slaHours: 4 },
  approved: { id: "approved", label: "Approved", group: "closed", role: "system", meaning: "Approval number and dates written to Epic", slaHours: null },
  not_required: { id: "not_required", label: "Not required", group: "closed", role: "system", meaning: "No approval needed; Epic marked with policy reference", slaHours: null },
  denied: { id: "denied", label: "Denied", group: "nurse", role: "nurse", meaning: "Insurer said no", slaHours: 8 },
  appeal: { id: "appeal", label: "Appeal", group: "nurse", role: "nurse", meaning: "Appeal or peer-to-peer in progress", slaHours: 24 },
  closed_denied: { id: "closed_denied", label: "Closed denied", group: "closed", role: "system", meaning: "Final denial; scheduling told", slaHours: null },
  cancelled: { id: "cancelled", label: "Cancelled", group: "closed", role: "system", meaning: "Order withdrawn or slot released by a person", slaHours: null },
};

export const GROUP_LABEL: Record<StatusGroup, string> = {
  automated: "Automated",
  coordinator: "Coordinator",
  nurse: "Nurse",
  insurer: "Insurer",
  closed: "Closed",
};

export type Channel = "api" | "portal";

/** Ready to submit is the system's job for API insurers and a coordinator task for portal insurers. */
export function ownerRoleFor(status: StatusId, channel: Channel | null): OwnerRole {
  if (status === "ready_to_submit" && channel === "portal") return "coordinator";
  return STATUSES[status].role;
}

export function isClosed(status: StatusId): boolean {
  return STATUSES[status].group === "closed";
}

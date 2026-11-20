import type { Channel, OrderStatus, ProcessingStep, ReasonCode } from "./types";

/** Status values that used to be written. They stay readable in audit history and cannot be written again. */
export const LEGACY_ORDER_STATUSES = [
  "RECEIVED",
  "PRE_PROCESSING",
  "UNREADABLE",
  "MATCHING",
  "UNMATCHED",
  "COVERAGE_CHECK",
  "APPROVAL_CHECK",
  "COLLECTING_EVIDENCE",
  "AWAITING_DOCUMENTS",
  "NEEDS_CORRECTION",
  "EVALUATING",
  "CLINICAL_REVIEW",
  "RULE_GAP",
  "READY_TO_SUBMIT",
  "MORE_INFO_REQUESTED",
  "APPEAL",
  "CLOSED_DENIED",
] as const;

export type LegacyOrderStatus = (typeof LEGACY_ORDER_STATUSES)[number] | "SUBMITTED" | "APPROVED" | "NOT_REQUIRED" | "DENIED" | "CANCELLED";

export interface LegacyOrder {
  status: string;
  channel?: Channel | null;
  blockingChecks?: readonly string[];
  confirmOnly?: boolean;
  /** The loop guard had already sent the order to clinical review. */
  repeatedRequests?: boolean;
  /** Closed denial came from a lost appeal rather than a decision not to appeal. */
  appealLost?: boolean;
  linkedApproval?: boolean;
  withdrawnBy?: "nurse" | "coordinator" | "slot";
}

export interface MigratedOrder {
  status: OrderStatus;
  reason: ReasonCode | null;
  step: ProcessingStep | null;
}

const PROCESSING_STEP: Record<string, ProcessingStep> = {
  RECEIVED: "INTAKE",
  PRE_PROCESSING: "PAGE_CHECKS",
  MATCHING: "MATCHING",
  COVERAGE_CHECK: "COVERAGE",
  APPROVAL_CHECK: "RULES",
  COLLECTING_EVIDENCE: "EVIDENCE",
  EVALUATING: "EVALUATING",
};

export function isWritableStatus(status: string): status is OrderStatus {
  return (
    status === "PROCESSING" ||
    status === "NEEDS_ADMIN_REVIEW" ||
    status === "NEEDS_CLINICAL_REVIEW" ||
    status === "SUBMITTED" ||
    status === "APPROVED" ||
    status === "NOT_REQUIRED" ||
    status === "DENIED" ||
    status === "CANCELLED"
  );
}

/**
 * Maps one stored row onto the 8 statuses. Audit `from_status` / `to_status` are left as written,
 * including the old names, so history stays readable.
 */
export function migrateOrder(row: LegacyOrder): MigratedOrder {
  const status = row.status;
  if (status in PROCESSING_STEP) {
    return { status: "PROCESSING", reason: null, step: PROCESSING_STEP[status] };
  }
  if (status === "READY_TO_SUBMIT") {
    if (row.channel === "portal") return { status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD", step: null };
    return { status: "PROCESSING", reason: null, step: "SUBMITTING" };
  }
  if (status === "UNREADABLE") return { status: "NEEDS_ADMIN_REVIEW", reason: "UNREADABLE_DOCUMENT", step: null };
  if (status === "UNMATCHED") return { status: "NEEDS_ADMIN_REVIEW", reason: "NO_MATCH", step: null };
  if (status === "AWAITING_DOCUMENTS") return { status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS", step: null };
  if (status === "MORE_INFO_REQUESTED") return { status: "NEEDS_ADMIN_REVIEW", reason: "MORE_INFO_REQUESTED", step: null };
  if (status === "NEEDS_CORRECTION") return { status: "NEEDS_ADMIN_REVIEW", reason: correctionReason(row.blockingChecks ?? []), step: null };
  if (status === "CLINICAL_REVIEW") {
    if (row.repeatedRequests) return { status: "NEEDS_CLINICAL_REVIEW", reason: "REPEATED_REQUESTS", step: null };
    if (row.confirmOnly) return { status: "NEEDS_CLINICAL_REVIEW", reason: "CONFIRM_AFTER_FIX", step: null };
    return { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET", step: null };
  }
  if (status === "RULE_GAP") return { status: "NEEDS_CLINICAL_REVIEW", reason: "RULE_GAP", step: null };
  if (status === "DENIED") return { status: "NEEDS_CLINICAL_REVIEW", reason: "DENIED_DECIDE_APPEAL", step: null };
  if (status === "SUBMITTED") return { status: "SUBMITTED", reason: "INITIAL_REQUEST", step: null };
  if (status === "APPEAL") return { status: "SUBMITTED", reason: "APPEAL", step: null };
  if (status === "APPROVED") return { status: "APPROVED", reason: row.linkedApproval ? "LINKED_EXISTING" : "NEW", step: null };
  if (status === "NOT_REQUIRED") return { status: "NOT_REQUIRED", reason: "NOT_ON_PA_LIST", step: null };
  if (status === "CLOSED_DENIED") return { status: "DENIED", reason: row.appealLost ? "APPEAL_LOST" : "NO_APPEAL", step: null };
  if (status === "CANCELLED") {
    const reason = row.withdrawnBy === "nurse" ? "WITHDRAWN_BY_NURSE" : row.withdrawnBy === "coordinator" ? "WITHDRAWN_BY_COORDINATOR" : row.withdrawnBy === "slot" ? "SLOT_RELEASED" : "EPIC_CANCELLED";
    return { status: "CANCELLED", reason, step: null };
  }
  if (isWritableStatus(status)) return { status, reason: null, step: status === "PROCESSING" ? "INTAKE" : null };
  throw new Error(`No migration for status ${status}`);
}

function correctionReason(checks: readonly string[]): ReasonCode {
  if (checks.includes("CO-1")) return "SIDE_MISMATCH";
  if (checks.includes("MA-3") || checks.includes("CO-4")) return "WRONG_PATIENT_PAGE";
  if (checks.includes("CV-1") || checks.includes("CO-5")) return "INSURER_MISMATCH";
  if (checks.includes("CO-2") || checks.includes("CO-3")) return "CPT_MISMATCH";
  return "SIDE_MISMATCH";
}

/** History rows keep the old status string. This only describes it; it does not make it writable. */
export function legacyStatusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

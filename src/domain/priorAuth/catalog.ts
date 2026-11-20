import type { DisplayGroup, DocumentStatus, OrderStatus, OwnerRole, Channel } from "./types";

export const ORDER_STATUSES = [
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
  "SUBMITTED",
  "MORE_INFO_REQUESTED",
  "DENIED",
  "APPEAL",
  "APPROVED",
  "NOT_REQUIRED",
  "CLOSED_DENIED",
  "CANCELLED",
] as const satisfies readonly OrderStatus[];

export const DOCUMENT_STATUSES = [
  "RECEIVED",
  "PRE_PROCESSED",
  "UNREADABLE",
  "UNMATCHED",
  "ATTACHED",
  "QUARANTINED",
  "SUPERSEDED",
] as const satisfies readonly DocumentStatus[];

export const CLOSED_ORDER_STATUSES = ["APPROVED", "NOT_REQUIRED", "CLOSED_DENIED", "CANCELLED"] as const satisfies readonly OrderStatus[];

export const CLOSED_DOCUMENT_STATUSES = ["QUARANTINED", "SUPERSEDED"] as const satisfies readonly DocumentStatus[];

/** Direct edges. Any open order status may also move to CANCELLED. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ["PRE_PROCESSING"],
  PRE_PROCESSING: ["MATCHING", "UNREADABLE"],
  UNREADABLE: ["RECEIVED"],
  MATCHING: ["COVERAGE_CHECK", "UNMATCHED", "NEEDS_CORRECTION"],
  UNMATCHED: ["COVERAGE_CHECK"],
  COVERAGE_CHECK: ["APPROVAL_CHECK", "NEEDS_CORRECTION", "APPROVED"],
  APPROVAL_CHECK: ["COLLECTING_EVIDENCE", "NOT_REQUIRED", "RULE_GAP"],
  COLLECTING_EVIDENCE: ["EVALUATING", "AWAITING_DOCUMENTS"],
  AWAITING_DOCUMENTS: ["COLLECTING_EVIDENCE", "CLINICAL_REVIEW"],
  NEEDS_CORRECTION: ["COVERAGE_CHECK", "COLLECTING_EVIDENCE"],
  EVALUATING: ["READY_TO_SUBMIT", "CLINICAL_REVIEW", "AWAITING_DOCUMENTS", "NEEDS_CORRECTION"],
  CLINICAL_REVIEW: ["READY_TO_SUBMIT", "AWAITING_DOCUMENTS", "CANCELLED"],
  RULE_GAP: ["READY_TO_SUBMIT", "CLINICAL_REVIEW", "CANCELLED"],
  READY_TO_SUBMIT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "DENIED", "MORE_INFO_REQUESTED"],
  MORE_INFO_REQUESTED: ["COLLECTING_EVIDENCE"],
  DENIED: ["APPEAL", "CLOSED_DENIED"],
  APPEAL: ["APPROVED", "CLOSED_DENIED"],
  APPROVED: [],
  NOT_REQUIRED: [],
  CLOSED_DENIED: [],
  CANCELLED: [],
};

export const DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  RECEIVED: ["PRE_PROCESSED", "UNREADABLE"],
  PRE_PROCESSED: ["ATTACHED", "UNMATCHED", "QUARANTINED"],
  UNREADABLE: ["SUPERSEDED"],
  UNMATCHED: ["ATTACHED", "QUARANTINED"],
  ATTACHED: ["SUPERSEDED", "QUARANTINED"],
  QUARANTINED: [],
  SUPERSEDED: [],
};

export interface StatusInfo {
  label: string;
  meaning: string;
  /** Hours before the time-in-status turns amber. Null for closed statuses. */
  slaHours: number | null;
  group: DisplayGroup;
}

export const ORDER_STATUS_INFO: Record<OrderStatus, StatusInfo> = {
  RECEIVED: { label: "Received", meaning: "An order arrived from the Epic order feed, or a document arrived that created a new order line.", group: "system", slaHours: 1 },
  PRE_PROCESSING: { label: "Pre-processing", meaning: "Documents are being straightened, checked for blank or missing pages, and checked for readability.", group: "system", slaHours: 1 },
  UNREADABLE: { label: "Unreadable", meaning: "Nothing usable can be read. The coordinator must get a clean copy.", group: "coordinator", slaHours: 4 },
  MATCHING: { label: "Matching", meaning: "Linking the documents to a patient and an order, and checking every page belongs to that patient.", group: "system", slaHours: 1 },
  UNMATCHED: { label: "Unmatched", meaning: "No confident patient or order match. A coordinator must place it by hand.", group: "coordinator", slaHours: 4 },
  COVERAGE_CHECK: { label: "Coverage check", meaning: "Confirming the insurer is active on the scan date, and looking for an approval already on file.", group: "system", slaHours: 1 },
  APPROVAL_CHECK: { label: "Approval check", meaning: "The rule engine decides whether this insurer, plan, CPT and setting needs approval.", group: "system", slaHours: 1 },
  COLLECTING_EVIDENCE: { label: "Collecting evidence", meaning: "Pulling records from Epic and extracting the facts each criterion needs.", group: "system", slaHours: 2 },
  AWAITING_DOCUMENTS: { label: "Awaiting documents", meaning: "A records request has gone out, or a document is missing or unreadable. The coordinator owns the chase.", group: "coordinator", slaHours: 24 },
  NEEDS_CORRECTION: { label: "Needs correction", meaning: "Something conflicts and a person must fix it at the source.", group: "coordinator", slaHours: 4 },
  EVALUATING: { label: "Evaluating", meaning: "Running the consistency checks, then the insurer's criteria, and deciding where the order goes.", group: "system", slaHours: 1 },
  CLINICAL_REVIEW: { label: "Clinical review", meaning: "The paperwork is complete but the criteria aren't met or aren't certain, or a nurse must confirm a coordinator fix.", group: "nurse", slaHours: 4 },
  RULE_GAP: { label: "Rule gap", meaning: "Approval is required, but the rule library has no criteria for this insurer and study.", group: "nurse", slaHours: 8 },
  READY_TO_SUBMIT: { label: "Ready to submit", meaning: "The packet is built and is waiting to be sent.", group: "system", slaHours: 2 },
  SUBMITTED: { label: "Submitted", meaning: "With the insurer. The system checks status on a schedule.", group: "insurer", slaHours: 48 },
  MORE_INFO_REQUESTED: { label: "More info requested", meaning: "The insurer asked for more documentation before deciding.", group: "coordinator", slaHours: 4 },
  DENIED: { label: "Denied", meaning: "The insurer said no. The nurse decides whether to appeal.", group: "nurse", slaHours: 8 },
  APPEAL: { label: "Appeal", meaning: "An appeal or peer-to-peer review is in progress.", group: "nurse", slaHours: 24 },
  APPROVED: { label: "Approved", meaning: "An approval covers the scan.", group: "closed", slaHours: null },
  NOT_REQUIRED: { label: "Not required", meaning: "No approval is needed.", group: "closed", slaHours: null },
  CLOSED_DENIED: { label: "Closed denied", meaning: "Final denial. Scheduling has been told.", group: "closed", slaHours: null },
  CANCELLED: { label: "Cancelled", meaning: "The order won't go ahead.", group: "closed", slaHours: null },
};

export const DOCUMENT_STATUS_INFO: Record<DocumentStatus, { label: string; meaning: string }> = {
  RECEIVED: { label: "Received", meaning: "File arrived from the fax inbox, Epic Media, or outside records." },
  PRE_PROCESSED: { label: "Pre-processed", meaning: "Pages straightened, blank pages flagged, every page labelled by type." },
  UNREADABLE: { label: "Unreadable", meaning: "Nothing usable." },
  UNMATCHED: { label: "Unmatched", meaning: "Can't be tied to a patient or order." },
  ATTACHED: { label: "Attached", meaning: "Linked to an order; facts extracted." },
  QUARANTINED: { label: "Quarantined", meaning: "Holds another patient's information." },
  SUPERSEDED: { label: "Superseded", meaning: "Replaced; kept for audit only." },
};

export function isOpenOrder(status: OrderStatus): boolean {
  return !CLOSED_ORDER_STATUSES.includes(status as (typeof CLOSED_ORDER_STATUSES)[number]);
}

export function isClosedOrder(status: OrderStatus): boolean {
  return !isOpenOrder(status);
}

export function isLegalOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (!isOpenOrder(from)) return false;
  if (to === "CANCELLED") return true;
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isLegalDocumentTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

/** Legal exits including the global cancel edge. Closed statuses have none. */
export function orderExits(status: OrderStatus): OrderStatus[] {
  if (!isOpenOrder(status)) return [];
  const direct = [...ORDER_TRANSITIONS[status]];
  if (!direct.includes("CANCELLED")) direct.push("CANCELLED");
  return direct;
}

export function documentExits(status: DocumentStatus): DocumentStatus[] {
  return [...DOCUMENT_TRANSITIONS[status]];
}

/**
 * Ready to submit is the system's job for API insurers and a coordinator's job for portal insurers.
 * Submitted stays with the system (the insurer is polled); a coordinator may still record a manual response.
 */
export function ownerRole(status: OrderStatus, channel: Channel | null): OwnerRole {
  if (status === "READY_TO_SUBMIT" && channel === "portal") return "coordinator";
  if (status === "SUBMITTED") return "system";
  const group = displayGroup(status, channel);
  if (group === "coordinator") return "coordinator";
  if (group === "nurse") return "nurse";
  return "system";
}

export function displayGroup(status: OrderStatus, channel: Channel | null): DisplayGroup {
  if (status === "READY_TO_SUBMIT" && channel === "portal") return "coordinator";
  return ORDER_STATUS_INFO[status].group;
}

/** CV-1 and CO-5 return to coverage. Every other correction returns to evidence collection. */
export function correctionDestination(blockingChecks: readonly string[]): "COVERAGE_CHECK" | "COLLECTING_EVIDENCE" {
  const coverage = blockingChecks.length > 0 && blockingChecks.every((id) => id === "CV-1" || id === "CO-5");
  return coverage ? "COVERAGE_CHECK" : "COLLECTING_EVIDENCE";
}

export const COVERAGE_CHECKS = ["CV-1", "CO-5"] as const;

export const DEFAULT_FOLLOW_UP = { rerequestHours: 24, phoneHours: 48 } as const;

/** Third entry into Awaiting documents (two prior entries) is redirected. */
export const AWAITING_LOOP_LIMIT = 2;

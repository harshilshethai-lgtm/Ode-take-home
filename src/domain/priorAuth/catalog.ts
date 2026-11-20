import type { Channel, DisplayGroup, DocumentStatus, OrderStatus, OwnerRole, ProcessingStep } from "./types";

export const ORDER_STATUSES = [
  "PROCESSING",
  "NEEDS_ADMIN_REVIEW",
  "NEEDS_CLINICAL_REVIEW",
  "SUBMITTED",
  "APPROVED",
  "NOT_REQUIRED",
  "DENIED",
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

export const CLOSED_ORDER_STATUSES = ["APPROVED", "NOT_REQUIRED", "DENIED", "CANCELLED"] as const satisfies readonly OrderStatus[];

export const OPEN_ORDER_STATUSES = ["PROCESSING", "NEEDS_ADMIN_REVIEW", "NEEDS_CLINICAL_REVIEW", "SUBMITTED"] as const satisfies readonly OrderStatus[];

export const CLOSED_DOCUMENT_STATUSES = ["QUARANTINED", "SUPERSEDED"] as const satisfies readonly DocumentStatus[];

/** The only legal status moves. Closed statuses have none. Cancel is an explicit edge, not a hidden one. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PROCESSING: ["NEEDS_ADMIN_REVIEW", "NEEDS_CLINICAL_REVIEW", "SUBMITTED", "APPROVED", "NOT_REQUIRED", "CANCELLED"],
  NEEDS_ADMIN_REVIEW: ["PROCESSING", "SUBMITTED", "APPROVED", "CANCELLED"],
  NEEDS_CLINICAL_REVIEW: ["PROCESSING", "SUBMITTED", "APPROVED", "DENIED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "NEEDS_ADMIN_REVIEW", "NEEDS_CLINICAL_REVIEW", "CANCELLED"],
  /** Reopens only for an Epic change before the scan. Every other closed status stays terminal. */
  APPROVED: ["PROCESSING"],
  NOT_REQUIRED: [],
  DENIED: [],
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
  group: DisplayGroup;
  owner: OwnerRole | "none";
  /** Hours before the row turns amber. Null when this status has no SLA. PROCESSING uses minutes, see PROCESSING_SLA_MINUTES. */
  slaHours: number | null;
}

/** A stuck pipeline is a bug. Configurable; 15 minutes unless a caller passes another limit. */
export const PROCESSING_SLA_MINUTES = 15;

export const ORDER_STATUS_INFO: Record<OrderStatus, StatusInfo> = {
  PROCESSING: {
    label: "Processing",
    meaning: "The pipeline is working on the order. No person needs to act.",
    group: "automated",
    owner: "system",
    slaHours: PROCESSING_SLA_MINUTES / 60,
  },
  NEEDS_ADMIN_REVIEW: {
    label: "Needs admin review",
    meaning: "Paperwork or logistics a coordinator must handle.",
    group: "coordinator",
    owner: "coordinator",
    slaHours: 4,
  },
  NEEDS_CLINICAL_REVIEW: {
    label: "Needs clinical review",
    meaning: "A clinical judgement, or a decision only a nurse makes.",
    group: "nurse",
    owner: "nurse",
    slaHours: 4,
  },
  SUBMITTED: {
    label: "Submitted",
    meaning: "With the insurer, waiting for a decision.",
    group: "insurer",
    owner: "system",
    slaHours: 48,
  },
  APPROVED: {
    label: "Approved",
    meaning: "Approval written to Epic.",
    group: "closed",
    owner: "none",
    slaHours: null,
  },
  NOT_REQUIRED: {
    label: "Not required",
    meaning: "No approval needed for this insurer, CPT and setting.",
    group: "closed",
    owner: "none",
    slaHours: null,
  },
  DENIED: {
    label: "Denied",
    meaning: "Final denial. The nurse chose not to appeal, or the appeal was lost.",
    group: "closed",
    owner: "none",
    slaHours: null,
  },
  CANCELLED: {
    label: "Cancelled",
    meaning: "The order was cancelled in Epic, or a person withdrew it.",
    group: "closed",
    owner: "none",
    slaHours: null,
  },
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

export const STEP_LABEL: Record<ProcessingStep, string> = {
  INTAKE: "Receiving documents",
  PAGE_CHECKS: "Checking pages",
  MATCHING: "Matching to patient and order",
  COVERAGE: "Checking insurance and approvals on file",
  RULES: "Looking up {insurer} rules",
  EVIDENCE: "Pulling records and extracting evidence",
  EVALUATING: "Checking {n} criteria",
  SUBMITTING: "Sending to {insurer}",
};

export function isOpenOrder(status: OrderStatus): boolean {
  return OPEN_ORDER_STATUSES.includes(status as (typeof OPEN_ORDER_STATUSES)[number]);
}

export function isClosedOrder(status: OrderStatus): boolean {
  return !isOpenOrder(status);
}

export function isLegalOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isLegalDocumentTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

export function orderExits(status: OrderStatus): OrderStatus[] {
  return [...ORDER_TRANSITIONS[status]];
}

export function documentExits(status: DocumentStatus): DocumentStatus[] {
  return [...DOCUMENT_TRANSITIONS[status]];
}

export function ownerRole(status: OrderStatus, _channel: Channel | null = null): OwnerRole {
  const owner = ORDER_STATUS_INFO[status].owner;
  return owner === "none" ? "system" : owner;
}

export function displayGroup(status: OrderStatus, _channel: Channel | null = null): DisplayGroup {
  return ORDER_STATUS_INFO[status].group;
}

/** Insurer mismatches re-enter the pipeline at coverage. Every other return starts again at intake. */
export function resumeStepFor(reason: string | null): ProcessingStep {
  return reason === "INSURER_MISMATCH" ? "COVERAGE" : "INTAKE";
}

export const DEFAULT_FOLLOW_UP = { rerequestHours: 24, phoneHours: 48 } as const;

/** The third entry into missing documents (two already recorded) goes to a nurse. */
export const MISSING_DOCUMENTS_LOOP_LIMIT = 2;

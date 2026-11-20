import type { Channel, StatusId } from "../statuses";
import type { Channel as AuthChannel, OrderStatus } from "./types";

const TO_ORDER = {
  received: "RECEIVED",
  pre_processing: "PRE_PROCESSING",
  unreadable: "UNREADABLE",
  matching: "MATCHING",
  unmatched: "UNMATCHED",
  coverage_check: "COVERAGE_CHECK",
  approval_check: "APPROVAL_CHECK",
  collecting_evidence: "COLLECTING_EVIDENCE",
  awaiting_documents: "AWAITING_DOCUMENTS",
  needs_correction: "NEEDS_CORRECTION",
  evaluating: "EVALUATING",
  clinical_review: "CLINICAL_REVIEW",
  rule_gap: "RULE_GAP",
  ready_to_submit: "READY_TO_SUBMIT",
  submitted: "SUBMITTED",
  more_info_requested: "MORE_INFO_REQUESTED",
  approved: "APPROVED",
  not_required: "NOT_REQUIRED",
  denied: "DENIED",
  appeal: "APPEAL",
  closed_denied: "CLOSED_DENIED",
  cancelled: "CANCELLED",
} as const satisfies Record<StatusId, OrderStatus>;

const TO_LEGACY = Object.fromEntries(Object.entries(TO_ORDER).map(([legacy, status]) => [status, legacy])) as {
  [K in OrderStatus]: StatusId;
};

export function toOrderStatus(status: StatusId): OrderStatus {
  return TO_ORDER[status];
}

export function toStatusId(status: OrderStatus): StatusId {
  return TO_LEGACY[status];
}

export function toChannel(channel: Channel | null): AuthChannel | null {
  return channel;
}

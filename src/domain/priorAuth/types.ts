// Prior-auth status model. No UI imports. Enum values match the worklist spec exactly.

export type OrderStatus =
  | "RECEIVED"
  | "PRE_PROCESSING"
  | "UNREADABLE"
  | "MATCHING"
  | "UNMATCHED"
  | "COVERAGE_CHECK"
  | "APPROVAL_CHECK"
  | "COLLECTING_EVIDENCE"
  | "AWAITING_DOCUMENTS"
  | "NEEDS_CORRECTION"
  | "EVALUATING"
  | "CLINICAL_REVIEW"
  | "RULE_GAP"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "MORE_INFO_REQUESTED"
  | "DENIED"
  | "APPEAL"
  | "APPROVED"
  | "NOT_REQUIRED"
  | "CLOSED_DENIED"
  | "CANCELLED";

export type DocumentStatus =
  | "RECEIVED"
  | "PRE_PROCESSED"
  | "UNREADABLE"
  | "UNMATCHED"
  | "ATTACHED"
  | "QUARANTINED"
  | "SUPERSEDED";

/** Automated check ids. PP-1 and PP-6 never fail. */
export type CheckId =
  | "PP-1"
  | "PP-2"
  | "PP-3"
  | "PP-4"
  | "PP-5"
  | "PP-6"
  | "MA-1"
  | "MA-2"
  | "MA-3"
  | "CV-1"
  | "CV-2"
  | "CO-1"
  | "CO-2"
  | "CO-3"
  | "CO-4"
  | "CO-5";

export type ConsistencyCheckId = "CO-1" | "CO-2" | "CO-3" | "CO-4" | "CO-5";

export type PageType =
  | "cover"
  | "request_form"
  | "office_note"
  | "pt_note"
  | "imaging_report"
  | "pathology"
  | "insurance_card"
  | "handwritten_note"
  | "other";

export type CriterionResultCode = "MET" | "WAIVED" | "EXCEPTION_MET" | "NOT_MET" | "UNCLEAR";

export type FailureClass = "documents" | "clinical";

export type EvidenceSourceKind =
  | "clinician_documented"
  | "therapist_documented"
  | "imaging_report"
  | "pathology"
  | "patient_reported";

export interface EvidenceRef {
  documentId: string;
  page: number | null;
  quote: string;
}

export interface CriterionResult {
  criterionId: string;
  result: CriterionResultCode;
  /** Only for NOT_MET and UNCLEAR. */
  failureClass: FailureClass | null;
  /** 0 to 1. */
  confidence: number;
  evidence: EvidenceRef | null;
  sourceKind?: EvidenceSourceKind;
  /** When false, a patient-reported source may count. Default true. */
  documentationRequired?: boolean;
  /** Overrides the evaluation-wide confidence threshold. */
  threshold?: number;
  label?: string;
}

export type Channel = "api" | "portal";

export type DisplayGroup = "system" | "coordinator" | "nurse" | "insurer" | "closed";

export type PillTone = "system" | "coordinator" | "nurse" | "approved" | "denied" | "cancelled";

export type OwnerRole = "system" | "coordinator" | "nurse";

export type UserRole = "coordinator" | "nurse" | "rules_admin";

export type RoutingMode = "straight_to_submission" | "nurse_signoff" | "nurse_if_changed";

export interface RoutingRule {
  mode: RoutingMode;
  /** Most specific scope. Example: "CO-4" or "PP-3". */
  failureType?: string;
  studyType?: string;
  insurer?: string;
  hospital?: string;
}

export interface RoutingPolicy {
  version: string;
  rules: RoutingRule[];
}

export interface RoutingContext {
  failureType?: string;
  studyType?: string;
  insurer?: string;
  hospital?: string;
}

export interface ApprovalInput {
  number: string;
  cpt: string;
  validFrom: string;
  validTo: string;
  /** True when CV-2 linked an approval already on file. */
  linked?: boolean;
}

export type Actor =
  | { kind: "system" }
  | { kind: "user"; id: string; role: UserRole; permissions: Array<"cancel"> };

export interface OrderSnapshot {
  id: string;
  status: OrderStatus;
  statusVersion: number;
  channel: Channel | null;
  blockingChecks: string[];
  fixableGaps: boolean;
  awaitingDocumentsEntries: number;
  confirmOnly: boolean;
  linkedApproval: boolean;
  approval: ApprovalInput | null;
  createdAt: string;
}

export interface DocumentSnapshot {
  id: string;
  orderId: string | null;
  status: DocumentStatus;
  statusVersion: number;
  pageNumbers: number[];
  parentDocumentId: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  orderId: string | null;
  documentId: string | null;
  fromStatus: string;
  toStatus: string;
  /** "system" or a user id. */
  actor: string;
  at: string;
  reason: string;
  checkIds: string[];
  criterionResults: CriterionResult[] | null;
  evidenceRefs: EvidenceRef[];
  ruleVersion: string | null;
  routingPolicyVersion: string | null;
}

export type Effect =
  | { type: "records_request"; orderId: string; detail: string }
  | { type: "follow_up_timer"; orderId: string; rerequestHours: number; phoneHours: number }
  | { type: "privacy_report"; documentId: string; orderId: string | null }
  | { type: "rules_admin_task"; orderId: string; detail: string }
  | { type: "denial_backlog"; orderId: string; reason: string }
  | { type: "scheduling_notified"; orderId: string }
  | { type: "release_slot"; orderId: string }
  | { type: "epic_in_basket"; orderId: string }
  | { type: "write_epic_approval"; orderId: string; approval: ApprovalInput }
  | { type: "epic_not_required"; orderId: string; policyId: string | null }
  | { type: "resend_request"; orderId: string }
  | { type: "notify_ordering_doctor"; orderId: string }
  | { type: "message_ordering_doctor"; orderId: string }
  | { type: "open_packet"; orderId: string };

export interface TransitionContext {
  actor: Actor;
  expectedVersion: number;
  reason: string;
  checkIds?: string[];
  criterionResults?: CriterionResult[] | null;
  evidenceRefs?: EvidenceRef[];
  ruleVersion?: string | null;
  routingPolicyVersion?: string | null;
  note?: string;
  portalReference?: string;
  trackingNumber?: string;
  approval?: ApprovalInput | null;
  denialReason?: string;
  /** System may cancel only when Epic reports the order cancelled. */
  epicCancelled?: boolean;
  trigger?: "document_attached" | "resend_received" | "loop_guard";
  /** Coordinators cannot edit criterion results. Snapshots on the audit row are not edits. */
  mutateCriteria?: boolean;
  confirmOnly?: boolean;
  policyId?: string | null;
  now?: Date;
  /** Default 24h re-request, 48h phone call. */
  followUp?: { rerequestHours: number; phoneHours: number };
}

export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Illegal transition from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StaleVersionError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`Stale status version ${expected}, current is ${actual}`);
    this.name = "StaleVersionError";
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TransitionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionDeniedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

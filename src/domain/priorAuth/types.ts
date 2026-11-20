// Prior-auth status model. Eight statuses, plus a reason code on every order that is not mid-pipeline.
// No UI imports.

export type OrderStatus =
  | "PROCESSING"
  | "NEEDS_ADMIN_REVIEW"
  | "NEEDS_CLINICAL_REVIEW"
  | "SUBMITTED"
  | "APPROVED"
  | "NOT_REQUIRED"
  | "DENIED"
  | "CANCELLED";

/** Progress inside PROCESSING. Never a status and never a worklist filter. */
export type ProcessingStep =
  | "INTAKE"
  | "PAGE_CHECKS"
  | "MATCHING"
  | "COVERAGE"
  | "RULES"
  | "EVIDENCE"
  | "EVALUATING"
  | "SUBMITTING";

export type AdminReason =
  | "UNREADABLE_DOCUMENT"
  | "NO_MATCH"
  | "MISSING_DOCUMENTS"
  | "SIDE_MISMATCH"
  | "WRONG_PATIENT_PAGE"
  | "INSURER_MISMATCH"
  | "CPT_MISMATCH"
  | "PORTAL_UPLOAD"
  | "MEMBER_ID_MISSING"
  | "RETURN_TO_PROVIDER"
  | "SUBMISSION_FAILED"
  | "MORE_INFO_REQUESTED"
  | "STATUS_CHECK_FAILED"
  | "APPROVAL_MISMATCH"
  | "WRITEBACK_FAILED";

export type ClinicalReason =
  | "CRITERIA_NOT_MET"
  | "RULE_GAP"
  | "CONFIRM_AFTER_FIX"
  | "REPEATED_REQUESTS"
  | "DENIED_DECIDE_APPEAL"
  | "PEER_TO_PEER";

export type SubmittedReason = "INITIAL_REQUEST" | "AWAITING_DECISION" | "PENDED_BY_INSURER" | "APPEAL";

export type ApprovedReason = "NEW" | "LINKED_EXISTING" | "APPEAL_WON";

export type NotRequiredReason = "NOT_ON_PA_LIST" | "SETTING_EXEMPT";

export type DeniedReason = "NO_APPEAL" | "APPEAL_LOST";

export type CancelledReason = "EPIC_CANCELLED" | "WITHDRAWN_BY_NURSE" | "WITHDRAWN_BY_COORDINATOR" | "SLOT_RELEASED";

export type ReasonCode =
  | AdminReason
  | ClinicalReason
  | SubmittedReason
  | ApprovedReason
  | NotRequiredReason
  | DeniedReason
  | CancelledReason;

/** Structured facts a reason template fills. Never a free-text substitute for the reason code. */
export type ReasonDetail = Record<string, string | number | null>;

export interface OtherIssue {
  code: ReasonCode;
  detail: ReasonDetail;
}

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
  /** Duration and treatment length can be returned to the ordering doctor when no document would change them. */
  clinicalKind?: "duration" | "treatment_length" | "other";
  /** True when a document that may still arrive could change this result. */
  documentCouldChange?: boolean;
  /** A study that was never performed cannot be chased. */
  pendingDocument?: "never_performed" | "elsewhere";
}

export type Channel = "api" | "portal";

export type DisplayGroup = "automated" | "coordinator" | "nurse" | "insurer" | "closed";

export type PillTone = "processing" | "admin" | "clinical" | "submitted" | "approved" | "denied" | "cancelled";

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
  /** True when an approval already on file is linked and nothing is submitted. */
  linked?: boolean;
  side?: string | null;
  units?: number;
  facility?: string | null;
  provider?: string | null;
}

/** Epic events that reopen an approval before the scan. The system is the only actor. */
export type EpicReapprovalEvent = "scan_outside_approval" | "cpt_side_or_facility_changed" | "insurer_changed";

export type Actor =
  | { kind: "system" }
  | { kind: "user"; id: string; role: UserRole; permissions: Array<"cancel"> };

export interface OrderSnapshot {
  id: string;
  status: OrderStatus;
  statusVersion: number;
  channel: Channel | null;
  /** Null only while PROCESSING, which carries a step instead. */
  reason: ReasonCode | null;
  step: ProcessingStep | null;
  detail: ReasonDetail;
  otherIssues: OtherIssue[];
  /** How many times this order has entered MISSING_DOCUMENTS. */
  missingDocumentsEntries: number;
  /** Where a return to PROCESSING should resume. */
  resumeStep: ProcessingStep | null;
  submissionAttempts: number;
  /** True when the reason is CONFIRM_AFTER_FIX. */
  confirmOnly: boolean;
  linkedApproval: boolean;
  approval: ApprovalInput | null;
  /** Checks that explain an admin correction. Derived from the reason. */
  blockingChecks: string[];
  /** A nurse can send the order back because a document would still help. */
  fixableGaps: boolean;
  /** Epic has reported the scan as completed. Re-approval is then refused. */
  scanCompleted: boolean;
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
  /** Current status, or a legacy status kept so history stays readable. */
  fromStatus: string;
  toStatus: string;
  /** "system" or a user id. */
  actor: string;
  at: string;
  reason: string;
  reasonCode: string | null;
  step: ProcessingStep | null;
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
  | { type: "scheduling_notified"; orderId: string }
  | { type: "release_slot"; orderId: string }
  | { type: "write_epic_approval"; orderId: string; approval: ApprovalInput }
  | { type: "epic_not_required"; orderId: string; policyId: string | null }
  | { type: "resend_request"; orderId: string }
  | { type: "notify_ordering_doctor"; orderId: string }
  | { type: "message_ordering_doctor"; orderId: string }
  | { type: "open_packet"; orderId: string }
  | { type: "ops_lead_alert"; orderId: string; detail: string };

export interface TransitionContext {
  actor: Actor;
  expectedVersion: number;
  /** Destination reason. Null when the destination is PROCESSING. */
  reason: ReasonCode | null;
  detail?: ReasonDetail;
  otherIssues?: OtherIssue[];
  /** Required when entering PROCESSING. */
  step?: ProcessingStep | null;
  checkIds?: string[];
  criterionResults?: CriterionResult[] | null;
  evidenceRefs?: EvidenceRef[];
  ruleVersion?: string | null;
  routingPolicyVersion?: string | null;
  note?: string;
  portalReference?: string;
  approval?: ApprovalInput | null;
  /** System may cancel only when Epic reports the order cancelled. */
  epicCancelled?: boolean;
  trigger?: "document_attached" | "send_for_documents" | "approve_for_submission";
  /** Coordinators cannot edit criterion results. */
  mutateCriteria?: boolean;
  policyId?: string | null;
  now?: Date;
  /** Default 24h re-request, 48h phone call. */
  followUp?: { rerequestHours: number; phoneHours: number };
  fixableGaps?: boolean;
  /** Set only for APPROVED → PROCESSING. */
  epicEvent?: EpicReapprovalEvent;
  /** The Epic write was read back, or a person entered the Epic auth id. */
  writeBackConfirmed?: boolean;
  epicAuthId?: string;
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

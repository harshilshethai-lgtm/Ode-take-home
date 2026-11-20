// Prior-auth rule management: data model.
// Rules are data. Nothing in the engine knows about a specific payer; differences live in PolicyVersion config.

/* ----------------------------- Facts (engine input) ----------------------------- */

export const SOURCE_TYPES = [
  "pt_note",
  "clinic_note_treating_provider",
  "injection_record",
  "pharmacy_record",
  "imaging_report",
  "patient_reported",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type Laterality = "left" | "right" | "bilateral";

/** A structured, sourced fact. Extracted upstream (LLM or human); the engine never reads notes. */
export interface Fact {
  id: string;
  /** e.g. symptom_onset, conservative_treatment, imaging_study, imaging_history_reviewed, exception_condition, document */
  type: string;
  value: unknown;
  /** ISO date (YYYY-MM-DD). Meaning depends on type: onset date, treatment end date, study date, document date. */
  date: string;
  laterality?: Laterality;
  sourceType: SourceType;
  sourceDocumentId: string;
  excerpt: string;
}

/** Pointer from a result back to the fact (and document) that supports it. */
export interface FactRef {
  factId: string;
  sourceDocumentId: string;
  sourceType: SourceType;
  date: string;
  excerpt: string;
}

/* ----------------------------- Statuses ----------------------------- */

export type CriterionStatus = "met" | "not_met" | "unknown" | "needs_review" | "waived";
/** Only these count toward approval. */
export const PASSING_STATUSES: CriterionStatus[] = ["met", "waived"];

export type OverallStatus = "approve_ready" | "missing_info" | "not_eligible" | "needs_review";
export type EvaluationOverall = OverallStatus | "no_policy_found";

export type EvaluationMode = "auto" | "human_review";

/**
 * Why a criterion can fail. clinical: the patient does not meet it, so paperwork cannot fix it.
 * fixable: documentation or a test is missing and can be obtained.
 */
export type FailureType = "clinical" | "fixable";

/* ----------------------------- Properties ----------------------------- */

export interface EvaluationContext {
  /** ISO date the service is (or will be) performed. All windows are measured back from here. */
  serviceDate: string;
  laterality?: Laterality;
  cptCode: string;
  planType: string;
  /** The policy's body site. Imaging facts only count when they are of this site. */
  bodySite: string;
}

/**
 * What the engine can verify against facts. Filters narrow the facts a criterion looks at
 * (within_months, source_in, source_not_in, same_side); measures decide the result (min_weeks, present, absent).
 */
export const CHECK_OPS = ["min_weeks", "within_months", "source_in", "source_not_in", "same_side", "present", "absent"] as const;
export type CheckOp = (typeof CHECK_OPS)[number];

export interface PropertyCheck {
  op: CheckOp;
  /** Which kind of fact the check reads, e.g. "conservative_treatment" or "mri". See domain/rules/facts.ts. */
  fact: string;
}

export type PropertyValue = string | number | boolean | string[];

/**
 * One thing the insurer states about a criterion or a policy: "Duration ...... 6 weeks".
 * Each policy defines its own; there is no global list. Without a check, a person reviews it.
 */
export interface Property {
  key: string;
  label: string;
  value: PropertyValue;
  unit?: string;
  check?: PropertyCheck;
  /** Set when the value is inferred rather than stated by the insurer: what was assumed and why. */
  assumption?: string;
}

/* ----------------------------- Policy model ----------------------------- */

export interface Payer {
  id: string;
  name: string;
  slug: string;
}

export interface Policy {
  id: string;
  payerId: string;
  externalPolicyId: string;
  title: string;
  bodySite: string;
  createdAt: string;
}

/** Stored lifecycle. scheduled / active / superseded are derived from publishedAt + effective dates. */
export type StoredVersionStatus = "draft" | "published" | "archived";
export type VersionStatus = "draft" | "scheduled" | "active" | "superseded" | "archived";

export type Setting = "outpatient" | "inpatient";
export type Channel = "api" | "portal" | "fax";
export type IncompleteHandling = "amendable" | "deny_resubmit_new" | "unspecified";

/** What the policy covers. Plan types are a policy property (plan_types), because only some insurers state them. */
export interface Applicability {
  cptCodes: string[];
  settings: Setting[] | "all";
}

export interface Criterion {
  id: string;
  policyVersionId: string;
  /** Stable slug that persists across versions. Diffs and analytics join on key. */
  key: string;
  /** The insurer's own reference, exactly as written: "2b", "(2)", or a table row label. Never invented. */
  ref: string;
  displayLabel: string;
  properties: Property[];
  evaluationMode: EvaluationMode;
  failureType: FailureType;
  /** Verbatim insurer text this criterion encodes. Shown behind "Source", never as the main text. */
  excerpt: string;
  sortOrder: number;
}

export interface PolicyException {
  id: string;
  policyVersionId: string;
  key: string;
  /** The insurer's own reference, as for criteria. */
  ref: string;
  displayLabel: string;
  /** Any one of these conditions activates the exception. */
  triggers: string[];
  /** Exact criterion keys waived. There is no "waive everything". */
  waivesCriterionKeys: string[];
  evaluationMode: EvaluationMode;
  excerpt: string;
  /** Set when part of the exception is inferred (for example which criteria it waives). */
  assumption: string | null;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  versionNumber: number;
  status: StoredVersionStatus;
  /** Required to publish. ISO date. */
  effectiveFrom: string | null;
  /** Inclusive. Set automatically when a later version is published. */
  effectiveTo: string | null;
  sourceRevisionLabel: string | null;
  sourceDocument: string | null;
  sourceDocumentHash: string | null;
  applicability: Applicability;
  logic: "ALL";
  /** Policy-level properties the insurer states: plan types, submission channels, attachments, incomplete requests. */
  properties: Property[];
  criteria: Criterion[];
  exceptions: PolicyException[];
  changeNote: string | null;
  createdBy: string;
  /** Last person to edit the draft (used by the two-person rule). */
  lastEditedBy: string;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clonedFromVersionId: string | null;
}

/** The editable surface of a draft. */
export type VersionEditableFields = Pick<
  PolicyVersion,
  | "applicability"
  | "logic"
  | "properties"
  | "criteria"
  | "exceptions"
  | "sourceRevisionLabel"
  | "sourceDocument"
  | "sourceDocumentHash"
  | "changeNote"
  | "effectiveFrom"
>;

/* ----------------------------- Tests & evaluations ----------------------------- */

export interface EvaluationInput {
  payerId: string;
  planType: string;
  cptCode: string;
  serviceDate: string;
  laterality?: Laterality;
  setting?: Setting;
  facts: Fact[];
}

export interface TestCase {
  id: string;
  policyId: string;
  name: string;
  description: string;
  /** Patient facts plus the order context. payerId is implied by the policy. */
  input: Omit<EvaluationInput, "payerId">;
  expected: {
    overall: OverallStatus;
    criteria?: Record<string, CriterionStatus>;
    submissionBlocked?: boolean;
  };
}

/** Frozen copy of everything the engine used, including the plain-English text at that moment. */
export interface RulesSnapshot {
  payerName: string;
  policyId: string;
  externalPolicyId: string;
  title: string;
  bodySite: string;
  versionId: string;
  versionNumber: number;
  sourceRevisionLabel: string | null;
  sourceDocument: string | null;
  sourceDocumentHash: string | null;
  applicability: Applicability;
  logic: "ALL";
  properties: Property[];
  criteria: Array<
    Pick<Criterion, "key" | "ref" | "displayLabel" | "properties" | "evaluationMode" | "failureType" | "excerpt"> & {
      /** True when any property is an assumption. */
      isAssumption: boolean;
      /** Plain-English rule text at evaluation time. */
      text: string;
    }
  >;
  exceptions: Array<
    Pick<PolicyException, "key" | "ref" | "displayLabel" | "triggers" | "waivesCriterionKeys" | "evaluationMode" | "excerpt" | "assumption">
  >;
}

export interface PropertyResult {
  key: string;
  label: string;
  status: Exclude<CriterionStatus, "waived">;
  detail: string;
}

export interface CriterionResult {
  criterionKey: string;
  displayLabel: string;
  status: CriterionStatus;
  /** Full sentence that cites the rule. */
  reason: string;
  evidenceRefs: FactRef[];
  waivedByExceptionKey?: string;
  ref: string;
  excerpt: string;
  /** The rule in plain English. */
  ruleText: string;
  isAssumption: boolean;
  /** One result per property, in order. Empty when the criterion was waived or recorded without detail. */
  propertyResults?: PropertyResult[];
}

export type ExceptionStatus = "not_triggered" | "applied" | "needs_review";

export interface ExceptionResult {
  exceptionKey: string;
  displayLabel: string;
  status: ExceptionStatus;
  triggeredBy: string[];
  evidenceRefs: FactRef[];
  waivesCriterionKeys: string[];
  ref: string;
  excerpt: string;
  isAssumption: boolean;
}

export interface MissingInfoItem {
  criterionKey: string;
  displayLabel: string;
  /** What the rule asks for, in plain English. */
  requirement: string;
  /** What was (not) found. */
  reason: string;
}

export type NoPolicyReason = "no_policy_for_cpt" | "plan_type_excluded" | "no_version_effective" | "setting_excluded";

export interface EvaluationOutcome {
  overall: EvaluationOverall;
  criterionResults: CriterionResult[];
  exceptionResults: ExceptionResult[];
  missingInfoChecklist: MissingInfoItem[];
  submissionBlocked: boolean;
  submissionBlockedMessage?: string;
  noPolicyReason?: NoPolicyReason;
  noPolicyMessage?: string;
  rulesSnapshot: RulesSnapshot | null;
}

export interface Evaluation extends EvaluationOutcome {
  id: string;
  patientRef: string;
  orderRef: string;
  serviceDate: string;
  cptCode: string;
  planType: string;
  payerId: string;
  /** Pinned. null only when no policy was found. */
  policyVersionId: string | null;
  /** Kept so "Re-run under current rules" can replay exactly the same facts. */
  input: EvaluationInput;
  engineVersion: string;
  createdAt: string;
  /**
   * "engine" = the facts were run through the rules engine (can be replayed exactly).
   * "recorded" = a case's outcome that was imported with its results already decided, so a re-check can only
   * carry results forward for criteria that did not change. Missing means "engine".
   */
  origin?: "engine" | "recorded";
}

export type AuditAction =
  | "created_draft"
  | "created_policy"
  | "edited"
  | "published"
  | "archived"
  | "cloned"
  | "test_run"
  | "rollback"
  | "evaluated"
  | "test_case_saved"
  | "config_changed"
  | "source_observed";

export interface AuditLog {
  id: string;
  actor: string;
  action: AuditAction;
  entityType: "policy_version" | "policy" | "evaluation" | "test_case" | "config" | "source_document";
  entityId: string;
  before: unknown;
  after: unknown;
  timestamp: string;
}

/** CPT a payer is known to require prior auth for (drives the coverage-gap panel). */
export interface PriorAuthRequirement {
  payerId: string;
  cptCode: string;
  description: string;
}

/* ----------------------------- Validation ----------------------------- */

export interface ValidationIssue {
  code: string;
  message: string;
  /** e.g. "criteria.conservative_care.properties.duration.value" */
  path: string;
  criterionKey?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/* ----------------------------- Users ----------------------------- */

export type RulesRole = "editor" | "approver";
export interface RulesUser {
  id: string;
  name: string;
  role: RulesRole;
}

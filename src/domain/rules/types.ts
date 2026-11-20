// Prior-auth rule management: data model.
// Rules are data. Nothing in the engine knows about a specific payer; differences live in PolicyVersion config.

import type { ZodType } from "zod";

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

/* ----------------------------- Primitive contract ----------------------------- */

export interface EvaluationContext {
  /** ISO date the service is (or will be) performed. All windows are measured back from here. */
  serviceDate: string;
  laterality?: Laterality;
  cptCode: string;
  planType: string;
}

/** What a primitive returns: a status, a plain-English sentence, and the facts behind it. */
export interface PrimitiveResult {
  status: Exclude<CriterionStatus, "waived">;
  detail: string;
  evidenceRefs: FactRef[];
}

export interface Primitive<P = unknown> {
  type: string;
  /** Shown in the primitive dropdown. */
  label: string;
  /** One line explaining what the primitive checks, for editors. */
  summary: string;
  paramsSchema: ZodType<P>;
  /** Starting params when an editor picks this primitive. */
  defaultParams: P;
  evaluate(params: P, facts: Fact[], context: EvaluationContext): PrimitiveResult;
  /** The single source of human-readable rule text. */
  describe(params: P): string;
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

export interface Applicability {
  cptCodes: string[];
  planTypes: string[] | "all";
  settings: Setting[] | "all";
}

export interface Submission {
  channels: Channel[];
  requiredAttachments: string[];
  incompleteRequestHandling: IncompleteHandling;
}

export interface SourceCitation {
  /** Insurer's own section label, e.g. "§2b" or "Criterion 2". */
  section: string;
  /** Verbatim insurer text this criterion encodes. */
  excerpt: string;
}

export interface Criterion {
  id: string;
  policyVersionId: string;
  /** Stable slug that persists across versions. Diffs and analytics join on key. */
  key: string;
  displayLabel: string;
  type: string;
  params: Record<string, unknown>;
  evaluationMode: EvaluationMode;
  sourceCitation: SourceCitation;
  interpretationNote: string | null;
  /** True when the note records a guess rather than a stated rule. */
  isAssumption: boolean;
  sortOrder: number;
}

export interface PolicyException {
  id: string;
  policyVersionId: string;
  key: string;
  displayLabel: string;
  /** Any one of these conditions activates the exception. */
  triggers: string[];
  /** Exact criterion keys waived. There is no "waive everything". */
  waivesCriterionKeys: string[];
  evaluationMode: EvaluationMode;
  sourceCitation: SourceCitation;
  interpretationNote: string | null;
  isAssumption: boolean;
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
  submission: Submission;
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
  | "submission"
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
  versionId: string;
  versionNumber: number;
  sourceRevisionLabel: string | null;
  sourceDocument: string | null;
  sourceDocumentHash: string | null;
  applicability: Applicability;
  logic: "ALL";
  submission: Submission;
  criteria: Array<
    Pick<Criterion, "key" | "displayLabel" | "type" | "params" | "evaluationMode" | "sourceCitation"> & {
      interpretationNote: string | null;
      isAssumption: boolean;
      /** describe() output at evaluation time. */
      text: string;
    }
  >;
  exceptions: Array<
    Pick<
      PolicyException,
      "key" | "displayLabel" | "triggers" | "waivesCriterionKeys" | "evaluationMode" | "sourceCitation"
    > & { interpretationNote: string | null; isAssumption: boolean }
  >;
}

export interface CriterionResult {
  criterionKey: string;
  displayLabel: string;
  status: CriterionStatus;
  /** Full sentence that cites the rule. */
  reason: string;
  evidenceRefs: FactRef[];
  waivedByExceptionKey?: string;
  sourceCitation: SourceCitation;
  /** The rule in plain English (describe()). */
  ruleText: string;
  isAssumption: boolean;
}

export type ExceptionStatus = "not_triggered" | "applied" | "needs_review";

export interface ExceptionResult {
  exceptionKey: string;
  displayLabel: string;
  status: ExceptionStatus;
  triggeredBy: string[];
  evidenceRefs: FactRef[];
  waivesCriterionKeys: string[];
  sourceCitation: SourceCitation;
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
}

export type AuditAction =
  | "created_draft"
  | "edited"
  | "published"
  | "archived"
  | "cloned"
  | "test_run"
  | "rollback";

export interface AuditLog {
  id: string;
  actor: string;
  action: AuditAction;
  entityType: "policy_version" | "policy" | "evaluation";
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
  /** e.g. "criteria.conservative_care.params.minWeeks" */
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

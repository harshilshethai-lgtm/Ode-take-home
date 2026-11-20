import type { FindingFlag } from "./flags";
import type { ProcessingStep, ReasonCode, ReasonDetail, OtherIssue } from "./priorAuth/types";
import type { Channel, OwnerRole, StatusId } from "./statuses";

export interface ActivityEntry {
  at: string;
  actor: string;
  from: string;
  to: string;
  reason: string;
}

export interface Person {
  id: string;
  name: string;
  role: Exclude<OwnerRole, "system">;
}

export interface Patient {
  name: string;
  mrn: string;
  dob: string; // ISO date
}

/** One line on the worklist = one imaging order. */
export interface Order {
  id: string;
  /** Test-library case number (PRD §Test case coverage). */
  caseNumber: number;
  /** "test-case" = real fixture with input PDF + answer key. "demo" = seeded row so the worklist has variety. */
  source: "test-case" | "demo";
  orderNumber: string | null;
  /** null for documents that could not be matched to a patient (Unmatched / Unreadable). */
  patient: Patient | null;
  study: string;
  cpt: string | null;
  side: "Left" | "Right" | null;
  priority: "Routine" | "Urgent";
  insurer: string | null;
  plan: string | null;
  channel: Channel | null;
  /** Local-time ISO string, no zone. */
  scheduledAt: string | null;
  status: StatusId;
  statusSince: string;
  /** Why the order is in this status. Null only while Processing, which uses `step`. */
  reasonCode: ReasonCode | null;
  /** Processing progress. Null for every other status. */
  step: ProcessingStep | null;
  /** Facts the reason template fills. */
  detail: ReasonDetail;
  otherIssues: OtherIssue[];
  /** When a missing-document follow-up comes due. Rows before that are waiting, not actionable. */
  followUpDueAt: string | null;
  /** Who a missing-document row is waiting on. */
  waitingOn: string | null;
  /** Person who claimed it; null = unassigned (or system-owned). */
  assigneeId: string | null;
  /** One-line explanation. The reason code is the source of truth; this is the filled template. */
  reason: string;
  /** Clinical review is only confirming a coordinator fix. */
  confirmOnly?: boolean;
  /** Approved by linking an approval already on file (CV-2). */
  linkedApproval?: boolean;
  /** Checks that put the order in Needs correction. CV-1 and CO-5 return to coverage. */
  blockingChecks?: string[];
  nextAction: string;
  attachmentCount: number;
  policyRef: string | null;
  /** Pipeline findings shown as flags on the worklist (rule violations, safety, coverage, missing pages). */
  findings?: FindingFlag[];
  /** The scan time was read from handwriting. Epic may still confirm it. */
  scheduleHandwritten?: boolean;
  /** Ferengi-style payers will not accept an incomplete packet. Submit stays off. */
  submissionBlocked?: boolean;
  /** Scott's simulated second fax has been attached. */
  faxAttached?: boolean;
  /** Steps from a live pipeline run. Newest first. */
  pipelineActivity?: ActivityEntry[];
  /** Replaces the status pill label after a pipeline finishes. */
  statusLabel?: string | null;
  /** Replaces the reason sentence while a pipeline is still talking. */
  reasonText?: string | null;
}

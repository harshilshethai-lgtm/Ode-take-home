import type { FindingFlag } from "./flags";
import type { Channel, OwnerRole, StatusId } from "./statuses";

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
  /** Person who claimed it; null = unassigned (or system-owned). */
  assigneeId: string | null;
  /** One line, e.g. "PT notes p.4 missing". */
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
}

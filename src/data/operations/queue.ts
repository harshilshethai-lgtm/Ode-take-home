import { reasonChip } from "@/domain/priorAuth/reasons";
import type { ReasonCode } from "@/domain/priorAuth/types";
import type { Channel, StatusId } from "@/domain/statuses";

/** Where an open case sits on the operations snapshot. */
export type QueueOwner = "ai" | "coordinator" | "nurse" | "insurer";

export type Autonomy = "preview" | "assisted" | "automatic";

/** Every seeded case is at the pilot site. The hospital select still scopes the page. */
export const HOSPITAL = "Pilot hospital";

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  preview: "Shadow",
  assisted: "Assisted",
  automatic: "Automatic",
};

/** Insurer autonomy. Ready to submit follows this, not the raw channel. */
export const INSURER_AUTONOMY: Record<string, Autonomy> = {
  "Federation Health": "automatic",
  "Vulcan Science Mutual": "automatic",
  "Klingon Assurance": "automatic",
  "Bajoran Health Plan": "automatic",
  "Ferengi Benefit Group": "assisted",
  "Andorian Life": "assisted",
};

export function autonomyFor(insurer: string | null, channel: Channel | null): Autonomy {
  if (insurer && INSURER_AUTONOMY[insurer]) return INSURER_AUTONOMY[insurer];
  if (channel === "api") return "automatic";
  if (channel === "portal") return "assisted";
  return "preview";
}

const DONE = new Set<StatusId>(["approved", "not_required", "denied", "cancelled"]);

/** Status → owner. Portal upload is a coordinator task. Submitted stays with the insurer. */
export function queueOwner(status: StatusId, _autonomy: Autonomy): QueueOwner | "done" {
  if (DONE.has(status)) return "done";
  if (status === "submitted") return "insurer";
  if (status === "needs_clinical_review") return "nurse";
  if (status === "needs_admin_review") return "coordinator";
  if (status === "processing") return "ai";
  throw new Error(`No operations owner for status ${status}`);
}

/** Grey reason line under an owner row, in chip order. */
export const REASON_ORDER: ReasonCode[] = [
  "MISSING_DOCUMENTS",
  "RETURN_TO_PROVIDER",
  "MEMBER_ID_MISSING",
  "UNREADABLE_DOCUMENT",
  "NO_MATCH",
  "SIDE_MISMATCH",
  "WRONG_PATIENT_PAGE",
  "INSURER_MISMATCH",
  "CPT_MISMATCH",
  "PORTAL_UPLOAD",
  "SUBMISSION_FAILED",
  "MORE_INFO_REQUESTED",
  "STATUS_CHECK_FAILED",
  "APPROVAL_MISMATCH",
  "WRITEBACK_FAILED",
  "CRITERIA_NOT_MET",
  "RULE_GAP",
  "CONFIRM_AFTER_FIX",
  "REPEATED_REQUESTS",
  "DENIED_DECIDE_APPEAL",
  "PEER_TO_PEER",
  "INITIAL_REQUEST",
  "AWAITING_DECISION",
  "PENDED_BY_INSURER",
  "APPEAL",
];

export const REASON_LABEL: Partial<Record<ReasonCode, string>> = Object.fromEntries(REASON_ORDER.map((code) => [code, reasonChip(code)]));

export interface OwnerDef {
  id: QueueOwner;
  name: string;
  definition: string;
}

/**
 * How long a case may sit with this owner. The worklist turns "In queue" red past the target.
 * Settings → Operations shows the coordinator and nurse numbers.
 */
export const QUEUE_TARGET_HOURS: Record<QueueOwner, number> = {
  ai: 0.25,
  coordinator: 4,
  nurse: 8,
  insurer: 48,
};

export const OWNERS: OwnerDef[] = [
  {
    id: "ai",
    name: "AI processing",
    definition: "Orders the pipeline is still reading. A run that sits here is a bug, not a task.",
  },
  {
    id: "coordinator",
    name: "Coordinator",
    definition: "Unreadable packets, missing documents, corrections, and portal uploads.",
  },
  {
    id: "nurse",
    name: "Nurse",
    definition: "Criteria that are not met, rule gaps, and denials waiting on a decision.",
  },
  {
    id: "insurer",
    name: "With insurer",
    definition: "Submitted and waiting on the insurer's decision.",
  },
];

export const DONE_PARTS: { label: string; statuses: StatusId[] }[] = [
  { label: "approved", statuses: ["approved"] },
  { label: "not required", statuses: ["not_required"] },
  { label: "denied", statuses: ["denied"] },
  { label: "cancelled", statuses: ["cancelled"] },
];

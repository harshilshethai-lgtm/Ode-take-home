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

const PIPELINE = new Set<StatusId>([
  "received",
  "pre_processing",
  "matching",
  "coverage_check",
  "approval_check",
  "collecting_evidence",
  "evaluating",
]);

/** Paperwork. Ready to submit for a non-automatic insurer is added in queueOwner. */
const COORDINATOR = new Set<StatusId>([
  "unreadable",
  "unmatched",
  "awaiting_documents",
  "needs_correction",
  "rule_gap",
  "more_info_requested",
]);

const NURSE = new Set<StatusId>(["clinical_review", "denied", "appeal"]);

const DONE = new Set<StatusId>(["approved", "not_required", "closed_denied", "cancelled"]);

/**
 * Status → owner. Ready to submit is AI for automatic insurers and Coordinator otherwise.
 * Rule gap is Coordinator here (no matching rule), even though the nurse queue still lists it.
 */
export function queueOwner(status: StatusId, autonomy: Autonomy): QueueOwner | "done" {
  if (DONE.has(status)) return "done";
  if (status === "submitted") return "insurer";
  if (status === "ready_to_submit") return autonomy === "automatic" ? "ai" : "coordinator";
  if (NURSE.has(status)) return "nurse";
  if (COORDINATOR.has(status)) return "coordinator";
  if (PIPELINE.has(status)) return "ai";
  throw new Error(`No operations owner for status ${status}`);
}

/** Grey reason line under an owner row. Ready to submit is counted on the row and not repeated here. */
export const REASON_LABEL: Partial<Record<StatusId, string>> = {
  awaiting_documents: "Awaiting documents",
  needs_correction: "Needs correction",
  unreadable: "Unreadable",
  unmatched: "Unmatched",
  rule_gap: "No matching rule",
  more_info_requested: "More info requested",
  clinical_review: "Clinical review",
  denied: "Denied",
  appeal: "Appeal",
};

export const REASON_ORDER: StatusId[] = [
  "awaiting_documents",
  "needs_correction",
  "unreadable",
  "unmatched",
  "rule_gap",
  "more_info_requested",
  "clinical_review",
  "denied",
  "appeal",
];

export interface OwnerDef {
  id: QueueOwner;
  name: string;
  definition: string;
}

export const OWNERS: OwnerDef[] = [
  {
    id: "ai",
    name: "AI processing",
    definition: "Orders the pipeline is still reading, and packets ready to send for an automatic insurer.",
  },
  {
    id: "coordinator",
    name: "Coordinator",
    definition:
      "Awaiting documents, needs correction, unreadable, no matching rule, and ready to submit for an assisted insurer.",
  },
  {
    id: "nurse",
    name: "Nurse",
    definition: "Clinical review, spot-check, and denied.",
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
  { label: "closed", statuses: ["closed_denied", "cancelled"] },
];

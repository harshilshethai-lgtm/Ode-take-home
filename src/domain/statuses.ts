// The eight order statuses. Reason codes live next to the status; they are not statuses.

export type StatusGroup = "automated" | "coordinator" | "nurse" | "insurer" | "closed";

export type OwnerRole = "system" | "coordinator" | "nurse" | "rules_admin";

export type StatusId =
  | "processing"
  | "needs_admin_review"
  | "needs_clinical_review"
  | "submitted"
  | "approved"
  | "not_required"
  | "denied"
  | "cancelled";

export interface StatusDef {
  id: StatusId;
  label: string;
  group: StatusGroup;
  role: OwnerRole;
  meaning: string;
  /** Hours before the row turns amber. Processing uses 15 minutes (0.25h). Null for closed statuses. */
  slaHours: number | null;
}

export const STATUSES: Record<StatusId, StatusDef> = {
  processing: {
    id: "processing",
    label: "Processing",
    group: "automated",
    role: "system",
    meaning: "The pipeline is working. No person needs to act.",
    slaHours: 0.25,
  },
  needs_admin_review: {
    id: "needs_admin_review",
    label: "Needs admin review",
    group: "coordinator",
    role: "coordinator",
    meaning: "Paperwork or logistics a coordinator must handle.",
    slaHours: 4,
  },
  needs_clinical_review: {
    id: "needs_clinical_review",
    label: "Needs clinical review",
    group: "nurse",
    role: "nurse",
    meaning: "A clinical judgement, or a decision only a nurse makes.",
    slaHours: 4,
  },
  submitted: {
    id: "submitted",
    label: "Submitted",
    group: "insurer",
    role: "system",
    meaning: "With the insurer, waiting for a decision.",
    slaHours: 48,
  },
  approved: {
    id: "approved",
    label: "Approved",
    group: "closed",
    role: "system",
    meaning: "Approval written to Epic.",
    slaHours: null,
  },
  not_required: {
    id: "not_required",
    label: "Not required",
    group: "closed",
    role: "system",
    meaning: "No approval needed for this insurer, CPT and setting.",
    slaHours: null,
  },
  denied: {
    id: "denied",
    label: "Denied",
    group: "closed",
    role: "system",
    meaning: "Final denial.",
    slaHours: null,
  },
  cancelled: {
    id: "cancelled",
    label: "Cancelled",
    group: "closed",
    role: "system",
    meaning: "Cancelled in Epic, or withdrawn by a person.",
    slaHours: null,
  },
};

export const GROUP_LABEL: Record<StatusGroup, string> = {
  automated: "Automated",
  coordinator: "Coordinator",
  nurse: "Nurse",
  insurer: "Insurer",
  closed: "Closed",
};

export type Channel = "api" | "portal";

export function ownerRoleFor(status: StatusId, _channel: Channel | null): OwnerRole {
  return STATUSES[status].role;
}

export function isClosed(status: StatusId): boolean {
  return STATUSES[status].group === "closed";
}

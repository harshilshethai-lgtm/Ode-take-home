import { ORDER_STATUS_INFO } from "./catalog";
import type { OrderSnapshot, OrderStatus, UserRole } from "./types";

export type ActionRequirement = "note" | "portalReference" | "cancelReason" | "insurerResponse" | "appealOutcome";

export interface StatusAction {
  id: string;
  label: string;
  /** Null when the action stays in the current status, or the target depends on an input. */
  to: OrderStatus | null;
  roles: Array<"coordinator" | "nurse">;
  requires: ActionRequirement[];
  when?: (order: OrderSnapshot) => boolean;
}

/** Buttons for the owner role, in the order the worklist shows them. The first is the primary action. */
export const STATUS_ACTIONS: Record<OrderStatus, readonly StatusAction[]> = {
  RECEIVED: [],
  PRE_PROCESSING: [],
  UNREADABLE: [
    { id: "request_resend", label: "Request resend", to: null, roles: ["coordinator"], requires: [] },
    { id: "copy_received", label: "Copy received", to: "RECEIVED", roles: ["coordinator"], requires: [] },
  ],
  MATCHING: [],
  UNMATCHED: [
    { id: "link_to_order", label: "Link to order", to: "COVERAGE_CHECK", roles: ["coordinator"], requires: [] },
    { id: "request_resend", label: "Request resend", to: null, roles: ["coordinator"], requires: [] },
  ],
  COVERAGE_CHECK: [],
  APPROVAL_CHECK: [],
  COLLECTING_EVIDENCE: [],
  AWAITING_DOCUMENTS: [
    { id: "resend_request", label: "Resend request", to: null, roles: ["coordinator"], requires: [] },
    { id: "documents_received", label: "Documents received", to: "COLLECTING_EVIDENCE", roles: ["coordinator"], requires: [] },
    { id: "escalate_to_nurse", label: "Escalate to nurse", to: "CLINICAL_REVIEW", roles: ["coordinator"], requires: [] },
  ],
  NEEDS_CORRECTION: [
    {
      id: "notify_ordering_doctor",
      label: "Notify ordering doctor",
      to: null,
      roles: ["coordinator"],
      requires: [],
      when: (order) => order.blockingChecks.some((id) => id === "CO-1" || id === "CO-2"),
    },
    { id: "correction_made", label: "Correction made", to: null, roles: ["coordinator"], requires: [] },
  ],
  EVALUATING: [],
  CLINICAL_REVIEW: [
    { id: "approve_for_submission", label: "Approve for submission", to: "READY_TO_SUBMIT", roles: ["nurse"], requires: ["note"] },
    { id: "cancel_order", label: "Cancel order", to: "CANCELLED", roles: ["nurse"], requires: ["cancelReason"] },
    { id: "message_ordering_doctor", label: "Message ordering doctor", to: null, roles: ["nurse"], requires: [] },
    {
      id: "send_back_for_documents",
      label: "Send back for documents",
      to: "AWAITING_DOCUMENTS",
      roles: ["nurse"],
      requires: [],
      when: (order) => order.fixableGaps,
    },
  ],
  RULE_GAP: [
    { id: "approve_for_submission", label: "Approve for submission", to: "READY_TO_SUBMIT", roles: ["nurse"], requires: ["note"] },
    { id: "move_to_clinical_review", label: "Move to clinical review", to: "CLINICAL_REVIEW", roles: ["nurse"], requires: [] },
    { id: "cancel_order", label: "Cancel order", to: "CANCELLED", roles: ["nurse"], requires: ["cancelReason"] },
  ],
  READY_TO_SUBMIT: [
    { id: "open_packet", label: "Open packet", to: null, roles: ["coordinator"], requires: [], when: (order) => order.channel === "portal" },
    { id: "uploaded", label: "Uploaded", to: "SUBMITTED", roles: ["coordinator"], requires: ["portalReference"], when: (order) => order.channel === "portal" },
  ],
  SUBMITTED: [{ id: "record_insurer_response", label: "Record insurer response", to: null, roles: ["coordinator"], requires: ["insurerResponse"] }],
  MORE_INFO_REQUESTED: [{ id: "gather_requested_items", label: "Gather requested items", to: "COLLECTING_EVIDENCE", roles: ["coordinator"], requires: [] }],
  DENIED: [
    { id: "start_appeal", label: "Start appeal", to: "APPEAL", roles: ["nurse"], requires: [] },
    { id: "close_as_denied", label: "Close as denied", to: "CLOSED_DENIED", roles: ["nurse"], requires: [] },
  ],
  APPEAL: [{ id: "record_appeal_outcome", label: "Record appeal outcome", to: null, roles: ["nurse"], requires: ["appealOutcome"] }],
  APPROVED: [],
  NOT_REQUIRED: [],
  CLOSED_DENIED: [],
  CANCELLED: [],
};

export function viewerRole(role: UserRole): "coordinator" | "nurse" {
  return role === "coordinator" ? "coordinator" : "nurse";
}

export function actionsFor(order: OrderSnapshot, role: UserRole): StatusAction[] {
  const viewer = viewerRole(role);
  return STATUS_ACTIONS[order.status].filter((action) => action.roles.includes(viewer) && (action.when?.(order) ?? true));
}

/** First action in the status list for this role. Nothing when this role has no action here. */
export function primaryActionLabel(order: OrderSnapshot, role: UserRole): string | null {
  return actionsFor(order, role)[0]?.label ?? null;
}

export function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_INFO[status].label;
}

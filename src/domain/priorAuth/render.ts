import { actionsFor, type ActionRequirement, type StatusAction } from "./actions";
import { ORDER_STATUS_INFO, PROCESSING_SLA_MINUTES, isClosedOrder, ownerRole } from "./catalog";
import { reasonChip } from "./reasons";
import type { OrderSnapshot, OrderStatus, PillTone, ReasonCode, UserRole } from "./types";

export type SavedView = "admin" | "clinical" | "in_flight" | "with_insurer" | "closed";

export const SAVED_VIEWS: { id: SavedView; label: string; hint: string }[] = [
  { id: "admin", label: "Admin queue", hint: "Paperwork, portal uploads and insurer requests" },
  { id: "clinical", label: "Clinical queue", hint: "Criteria, rule gaps and denials to decide" },
  { id: "in_flight", label: "In flight", hint: "The pipeline is working, or the insurer has it" },
  { id: "with_insurer", label: "With insurer", hint: "Awaiting, pended and appeal" },
  { id: "closed", label: "Closed", hint: "Approved, not required, denied or cancelled" },
];

export interface StatusPresentation {
  label: string;
  tone: PillTone;
  dashed: boolean;
  chip: string | null;
}

export function presentStatus(order: Pick<OrderSnapshot, "status" | "reason" | "linkedApproval">): StatusPresentation {
  return {
    label: ORDER_STATUS_INFO[order.status].label,
    tone: pillTone(order.status),
    dashed: order.status === "CANCELLED",
    chip: order.status === "PROCESSING" || !order.reason ? null : reasonChip(order.reason),
  };
}

export function pillTone(status: OrderStatus): PillTone {
  switch (status) {
    case "PROCESSING":
      return "processing";
    case "NEEDS_ADMIN_REVIEW":
      return "admin";
    case "NEEDS_CLINICAL_REVIEW":
      return "clinical";
    case "SUBMITTED":
      return "submitted";
    case "APPROVED":
    case "NOT_REQUIRED":
      return "approved";
    case "DENIED":
      return "denied";
    case "CANCELLED":
      return "cancelled";
  }
}

export function ownerLabel(order: Pick<OrderSnapshot, "status">, assigneeName: string | null): string {
  if (assigneeName) return assigneeName;
  if (isClosedOrder(order.status)) return "—";
  const role = ownerRole(order.status);
  if (role === "system") return "System";
  if (role === "coordinator") return "Coordinator";
  return "Nurse";
}

export interface ActionInput {
  note?: string;
  portalReference?: string;
  approval?: { number?: string; cpt?: string; validFrom?: string; validTo?: string } | null;
  epicAuthId?: string;
}

export interface RenderedAction {
  id: string;
  label: string;
  to: OrderStatus | null;
  reason: ReasonCode | null;
  primary: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

const REQUIREMENT_REASON: Record<ActionRequirement, string> = {
  note: "A note is required",
  portalReference: "Enter the portal reference number",
  approval: "Enter the approval number, CPT and dates",
  epicAuthId: "Enter the Epic auth id",
};

export function renderActions(order: Pick<OrderSnapshot, "reason">, role: UserRole, input: ActionInput = {}): RenderedAction[] {
  return actionsFor(order, role).map((action, index) => renderAction(action, input, index === 0));
}

function renderAction(action: StatusAction, input: ActionInput, primary: boolean): RenderedAction {
  const missing = action.requires.find((requirement) => !requirementMet(requirement, input));
  return {
    id: action.id,
    label: action.label,
    to: action.to,
    reason: action.reason,
    primary,
    disabled: missing !== undefined,
    disabledReason: missing ? REQUIREMENT_REASON[missing] : null,
  };
}

function requirementMet(requirement: ActionRequirement, input: ActionInput): boolean {
  switch (requirement) {
    case "note":
      return !!input.note?.trim();
    case "portalReference":
      return !!input.portalReference?.trim();
    case "approval":
      return !!input.approval?.number?.trim() && !!input.approval.cpt?.trim() && !!input.approval.validFrom?.trim() && !!input.approval.validTo?.trim();
    case "epicAuthId":
      return !!input.epicAuthId?.trim();
  }
}

export function inSavedView(args: { status: OrderStatus; view: SavedView }): boolean {
  const { status, view } = args;
  switch (view) {
    case "admin":
      return status === "NEEDS_ADMIN_REVIEW";
    case "clinical":
      return status === "NEEDS_CLINICAL_REVIEW";
    case "in_flight":
      return status === "PROCESSING" || status === "SUBMITTED";
    case "with_insurer":
      return status === "SUBMITTED";
    case "closed":
      return isClosedOrder(status);
  }
}

export function isOverSla(status: OrderStatus, elapsedMs: number, processingSlaMinutes = PROCESSING_SLA_MINUTES): boolean {
  if (status === "PROCESSING") return elapsedMs > processingSlaMinutes * 60 * 1000;
  const sla = ORDER_STATUS_INFO[status].slaHours;
  if (sla == null) return false;
  return elapsedMs > sla * 60 * 60 * 1000;
}

/** A missing-document row whose follow-up has not come due yet. It stays in the admin queue. */
export function isWaitingOnDocuments(reason: ReasonCode | null, followUpDueAt: string | null, now: Date): boolean {
  if (reason !== "MISSING_DOCUMENTS" || !followUpDueAt) return false;
  return new Date(followUpDueAt).getTime() > now.getTime();
}

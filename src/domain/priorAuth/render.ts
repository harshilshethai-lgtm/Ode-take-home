import { actionsFor, type ActionRequirement, type StatusAction } from "./actions";
import { ORDER_STATUS_INFO, displayGroup, isClosedOrder, ownerRole } from "./catalog";
import type { Channel, OrderSnapshot, OrderStatus, PillTone, UserRole } from "./types";

export type SavedView = "all" | "coordinator" | "nurse" | "in_flight" | "closed";

export const SAVED_VIEWS: { id: SavedView; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every order" },
  { id: "coordinator", label: "Coordinator", hint: "Paperwork, portal uploads and insurer follow-up" },
  { id: "nurse", label: "Nurse", hint: "Clinical gaps, rule gaps and denials" },
  { id: "in_flight", label: "In flight", hint: "The pipeline or the insurer has it" },
  { id: "closed", label: "Closed", hint: "Decided in the last 30 days" },
];

const COORDINATOR_QUEUE: readonly OrderStatus[] = [
  "UNREADABLE",
  "UNMATCHED",
  "AWAITING_DOCUMENTS",
  "NEEDS_CORRECTION",
  "MORE_INFO_REQUESTED",
];

const NURSE_QUEUE: readonly OrderStatus[] = ["CLINICAL_REVIEW", "RULE_GAP", "DENIED", "APPEAL"];

const SYSTEM_PIPELINE: readonly OrderStatus[] = [
  "RECEIVED",
  "PRE_PROCESSING",
  "MATCHING",
  "COVERAGE_CHECK",
  "APPROVAL_CHECK",
  "COLLECTING_EVIDENCE",
  "EVALUATING",
];

const CLOSED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface StatusPresentation {
  label: string;
  tone: PillTone;
  /** Grey dashed outline. */
  dashed: boolean;
  tags: Array<"confirm only" | "linked">;
}

export function presentStatus(order: Pick<OrderSnapshot, "status" | "channel" | "confirmOnly" | "linkedApproval">): StatusPresentation {
  const tags: StatusPresentation["tags"] = [];
  if (order.status === "CLINICAL_REVIEW" && order.confirmOnly) tags.push("confirm only");
  if (order.status === "APPROVED" && order.linkedApproval) tags.push("linked");
  return {
    label: ORDER_STATUS_INFO[order.status].label,
    tone: pillTone(order.status, order.channel),
    dashed: order.status === "CANCELLED",
    tags,
  };
}

export function pillTone(status: OrderStatus, channel: Channel | null): PillTone {
  if (status === "CANCELLED") return "cancelled";
  if (status === "CLOSED_DENIED") return "denied";
  if (status === "APPROVED" || status === "NOT_REQUIRED") return "approved";
  const group = displayGroup(status, channel);
  if (group === "coordinator") return "coordinator";
  if (group === "nurse") return "nurse";
  return "system";
}

export function ownerLabel(order: Pick<OrderSnapshot, "status" | "channel">, assigneeName: string | null): string {
  if (assigneeName) return assigneeName;
  const role = ownerRole(order.status, order.channel);
  if (role === "system") return "System";
  if (role === "coordinator") return "Coordinator";
  return "Nurse";
}

export interface ActionInput {
  note?: string;
  portalReference?: string;
  cancelReason?: string;
  insurerResponse?: "approved" | "denied" | "more_info" | null;
  appealOutcome?: "approved" | "closed_denied" | null;
}

export interface RenderedAction {
  id: string;
  label: string;
  to: OrderStatus | null;
  disabled: boolean;
  disabledReason: string | null;
}

const REQUIREMENT_REASON: Record<ActionRequirement, string> = {
  note: "A note is required",
  portalReference: "Enter the portal reference number",
  cancelReason: "A reason is required",
  insurerResponse: "Choose the insurer response",
  appealOutcome: "Choose the appeal outcome",
};

export function renderActions(order: OrderSnapshot, role: UserRole, input: ActionInput = {}): RenderedAction[] {
  return actionsFor(order, role).map((action) => renderAction(action, input));
}

function renderAction(action: StatusAction, input: ActionInput): RenderedAction {
  const missing = action.requires.find((requirement) => !requirementMet(requirement, input));
  return {
    id: action.id,
    label: action.label,
    to: action.to,
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
    case "cancelReason":
      return !!input.cancelReason?.trim();
    case "insurerResponse":
      return input.insurerResponse != null;
    case "appealOutcome":
      return input.appealOutcome != null;
  }
}

export function inSavedView(args: {
  status: OrderStatus;
  channel: Channel | null;
  statusSince: Date;
  view: SavedView;
  now: Date;
}): boolean {
  const { status, channel, view, now, statusSince } = args;
  switch (view) {
    case "all":
      return true;
    case "coordinator":
      return COORDINATOR_QUEUE.includes(status) || (status === "READY_TO_SUBMIT" && channel === "portal");
    case "nurse":
      return NURSE_QUEUE.includes(status);
    case "in_flight":
      return SYSTEM_PIPELINE.includes(status) || status === "SUBMITTED" || (status === "READY_TO_SUBMIT" && channel !== "portal");
    case "closed":
      return isClosedOrder(status) && now.getTime() - statusSince.getTime() <= CLOSED_WINDOW_MS;
  }
}

export function isOverSla(status: OrderStatus, elapsedMs: number): boolean {
  const sla = ORDER_STATUS_INFO[status].slaHours;
  if (sla == null) return false;
  return elapsedMs > sla * 60 * 60 * 1000;
}

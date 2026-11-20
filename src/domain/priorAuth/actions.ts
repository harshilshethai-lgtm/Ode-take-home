import { actionsFor as reasonActions, primaryAction, viewerRole, type ActionRequirement, type StatusAction } from "./reasons";
import type { OrderSnapshot, OrderStatus, UserRole } from "./types";

export type { ActionRequirement, StatusAction };

/** Buttons for this order's reason and the viewer's role. The first is primary. */
export function actionsFor(order: Pick<OrderSnapshot, "reason">, role: UserRole): StatusAction[] {
  return reasonActions(order, role);
}

export function primaryActionLabel(order: Pick<OrderSnapshot, "reason">, role: UserRole): string | null {
  return primaryAction(order, role)?.label ?? null;
}

export { viewerRole };

export function statusLabel(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    PROCESSING: "Processing",
    NEEDS_ADMIN_REVIEW: "Needs admin review",
    NEEDS_CLINICAL_REVIEW: "Needs clinical review",
    SUBMITTED: "Submitted",
    APPROVED: "Approved",
    NOT_REQUIRED: "Not required",
    DENIED: "Denied",
    CANCELLED: "Cancelled",
  };
  return labels[status];
}

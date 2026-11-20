import type { StatusTone } from "@/components/ui/status-dot";
import { STATUSES, type StatusId } from "@/domain/statuses";

/**
 * Worklist status -> dot color.
 * Green for a closed approval, amber for admin review, violet for a nurse, red for a denial.
 */
const OVERRIDE: Partial<Record<StatusId, StatusTone>> = {
  approved: "ready",
  not_required: "ready",
  denied: "blocked",
  needs_admin_review: "hold",
  needs_clinical_review: "review",
};

export function statusTone(status: StatusId, reasonCode?: string | null): StatusTone {
  if (reasonCode === "UNREADABLE_DOCUMENT") return "blocked";
  const o = OVERRIDE[status];
  if (o) return o;
  switch (STATUSES[status].group) {
    case "coordinator":
      return "hold";
    case "nurse":
      return "review";
    default:
      return "neutral";
  }
}

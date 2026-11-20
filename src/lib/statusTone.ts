import type { StatusTone } from "@/components/ui/status-dot";
import { STATUSES, type StatusId } from "@/domain/statuses";

/**
 * Worklist status -> dot color. Color means status:
 * green ready/approved, amber waiting on documents or a correction, red blocked/denied/unreadable,
 * violet with a nurse, gray for everything automated or closed.
 */
const OVERRIDE: Partial<Record<StatusId, StatusTone>> = {
  ready_to_submit: "ready",
  approved: "ready",
  unreadable: "blocked",
  denied: "blocked",
  closed_denied: "blocked",
};

export function statusTone(status: StatusId): StatusTone {
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

import { StatusLabel } from "@/components/ui/status-dot";
import { toOrderStatus, toReasonCode } from "@/domain/priorAuth/legacy";
import { presentStatus } from "@/domain/priorAuth/render";
import type { Channel, StatusId } from "@/domain/statuses";
import { statusTone } from "@/lib/statusTone";

/**
 * Status from the engine, drawn as a 6px dot and a gray label.
 * The dot is the only color. The label is never re-derived here.
 */
export function StatusPill({
  status,
  reasonCode = null,
  label,
}: {
  status: StatusId;
  channel: Channel | null;
  reasonCode?: string | null;
  confirmOnly?: boolean;
  linked?: boolean;
  /** Replaces the catalog label after a pipeline finishes. */
  label?: string | null;
}) {
  const presentation = presentStatus({
    status: toOrderStatus(status),
    reason: toReasonCode(reasonCode),
    linkedApproval: false,
  });
  return <StatusLabel tone={statusTone(status, reasonCode)}>{label || presentation.label}</StatusLabel>;
}

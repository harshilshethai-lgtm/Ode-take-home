import { cn } from "@/lib/cn";
import { toOrderStatus, toReasonCode } from "@/domain/priorAuth/legacy";
import { presentStatus } from "@/domain/priorAuth/render";
import type { Channel, StatusId } from "@/domain/statuses";
import type { PillTone } from "@/domain/priorAuth/types";

const TONE: Record<PillTone, string> = {
  processing: "border-transparent bg-status-system-bg text-status-system",
  admin: "border-transparent bg-status-coordinator-bg text-status-coordinator",
  clinical: "border-transparent bg-status-nurse-bg text-status-nurse",
  submitted: "border-line bg-transparent text-fg",
  approved: "border-transparent bg-status-approved-bg text-status-approved",
  denied: "border-transparent bg-status-denied-bg text-status-denied",
  cancelled: "border-dashed border-fg-3 bg-transparent text-fg-2",
};

/** Status label in the group colour. The enum value is never shown. */
export function StatusPill({
  status,
  reasonCode = null,
}: {
  status: StatusId;
  channel: Channel | null;
  reasonCode?: string | null;
  confirmOnly?: boolean;
  linked?: boolean;
}) {
  const presentation = presentStatus({
    status: toOrderStatus(status),
    reason: toReasonCode(reasonCode),
    linkedApproval: false,
  });
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-caption", TONE[presentation.tone])}>
      {presentation.label}
    </span>
  );
}

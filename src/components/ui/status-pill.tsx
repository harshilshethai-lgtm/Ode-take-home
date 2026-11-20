import { cn } from "@/lib/cn";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { presentStatus } from "@/domain/priorAuth/render";
import type { Channel, StatusId } from "@/domain/statuses";
import type { PillTone } from "@/domain/priorAuth/types";

const TONE: Record<PillTone, string> = {
  system: "border-transparent bg-status-system-bg text-status-system",
  coordinator: "border-transparent bg-status-coordinator-bg text-status-coordinator",
  nurse: "border-transparent bg-status-nurse-bg text-status-nurse",
  approved: "border-transparent bg-status-approved-bg text-status-approved",
  denied: "border-transparent bg-status-denied-bg text-status-denied",
  cancelled: "border-dashed border-fg-3 bg-transparent text-fg-2",
};

/** Status label in the group colour. The enum value is never shown. */
export function StatusPill({
  status,
  channel,
  confirmOnly = false,
  linked = false,
}: {
  status: StatusId;
  channel: Channel | null;
  confirmOnly?: boolean;
  linked?: boolean;
}) {
  const presentation = presentStatus({
    status: toOrderStatus(status),
    channel,
    confirmOnly,
    linkedApproval: linked,
  });
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-caption", TONE[presentation.tone])}>
      {presentation.label}
      {presentation.tags.map((tag) => (
        <span key={tag} className="font-normal opacity-80">
          {tag}
        </span>
      ))}
    </span>
  );
}

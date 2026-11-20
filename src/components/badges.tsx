import { STATUSES, type StatusGroup, type StatusId } from "@/domain/statuses";

const GROUP_DOT: Record<StatusGroup, string> = {
  automated: "bg-slate-400",
  coordinator: "bg-amber-500",
  nurse: "bg-violet-500",
  insurer: "bg-sky-500",
  closed: "bg-emerald-500",
};

const STATUS_DOT_OVERRIDE: Partial<Record<StatusId, string>> = {
  ready_to_submit: "bg-emerald-500",
  denied: "bg-rose-500",
  closed_denied: "bg-rose-500",
  unreadable: "bg-rose-500",
  cancelled: "bg-slate-300",
};

/** One status at a time: a colored dot (by who owns it) and the status name. Quiet on purpose. */
export function StatusLabel({ status }: { status: StatusId }) {
  const def = STATUSES[status];
  const dot = STATUS_DOT_OVERRIDE[status] ?? GROUP_DOT[def.group];
  return (
    <span title={def.meaning} className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-slate-800">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {def.label}
    </span>
  );
}

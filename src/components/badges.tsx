import { STATUSES, type StatusGroup, type StatusId } from "@/domain/statuses";
import { TIME_RISK_LABEL, type TimeRisk } from "@/domain/timeRisk";

const GROUP_STYLE: Record<StatusGroup, string> = {
  automated: "bg-slate-100 text-slate-700 ring-slate-200",
  coordinator: "bg-amber-50 text-amber-800 ring-amber-200",
  nurse: "bg-violet-50 text-violet-800 ring-violet-200",
  insurer: "bg-sky-50 text-sky-800 ring-sky-200",
  closed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

const STATUS_OVERRIDE: Partial<Record<StatusId, string>> = {
  ready_to_submit: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  denied: "bg-rose-50 text-rose-800 ring-rose-200",
  closed_denied: "bg-rose-50 text-rose-800 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  unreadable: "bg-rose-50 text-rose-800 ring-rose-200",
};

export function StatusBadge({ status }: { status: StatusId }) {
  const def = STATUSES[status];
  const style = STATUS_OVERRIDE[status] ?? GROUP_STYLE[def.group];
  return (
    <span
      title={def.meaning}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {def.label}
    </span>
  );
}

const RISK_STYLE: Record<Exclude<TimeRisk, "none">, { dot: string; text: string }> = {
  on_track: { dot: "bg-emerald-500", text: "text-emerald-700" },
  at_risk: { dot: "bg-amber-500", text: "text-amber-700" },
  slot_at_risk: { dot: "bg-rose-500", text: "text-rose-700" },
};

export function TimeRiskBadge({ risk }: { risk: TimeRisk }) {
  if (risk === "none") return <span className="text-xs text-slate-400">—</span>;
  const s = RISK_STYLE[risk];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {TIME_RISK_LABEL[risk]}
    </span>
  );
}

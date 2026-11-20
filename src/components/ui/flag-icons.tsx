import {
  AlarmClock,
  CalendarX,
  Clock,
  CreditCard,
  FileMinus,
  FileX,
  Hourglass,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { FLAG_DEFS, type Flag, type FlagId } from "@/domain/flags";
import { cn } from "@/lib/cn";
import { Tip } from "./tooltip";

const FLAG_ICON: Record<FlagId, LucideIcon> = {
  safety: ShieldAlert,
  slot_at_risk: CalendarX,
  scan_at_risk: AlarmClock,
  urgent: Siren,
  rule_violation: FileX,
  coverage: CreditCard,
  missing_docs: FileMinus,
  at_risk: Clock,
  over_sla: Hourglass,
};

// Flags are status: red for blocking danger, amber for warnings.
const TONE = { danger: "text-red-500", warn: "text-amber-500" } as const;

export function FlagIcon({ flag }: { flag: Flag }) {
  const def = FLAG_DEFS[flag.id];
  const Icon = FLAG_ICON[flag.id];
  const text = flag.detail ? `${def.label}: ${flag.detail}` : def.label;
  return (
    <Tip content={text}>
      <span role="img" aria-label={text} className={cn("inline-flex", TONE[def.tone])}>
        <Icon size={14} />
      </span>
    </Tip>
  );
}

/** Flags column: at most 2 icons, most severe first, each with a tooltip. The tooltip is the legend. */
export function FlagIcons({ flags, max = 2 }: { flags: Flag[]; max?: number }) {
  if (flags.length === 0) return null;
  const rest = flags.slice(max);
  return (
    <span className="inline-flex items-center gap-2">
      {flags.slice(0, max).map((f) => (
        <FlagIcon key={f.id} flag={f} />
      ))}
      {rest.length > 0 && (
        <Tip content={rest.map((f) => FLAG_DEFS[f.id].label).join(", ")}>
          <span className="text-caption text-fg-2">+{rest.length}</span>
        </Tip>
      )}
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  CalendarX,
  Clock,
  CreditCard,
  FileMinus,
  FileX,
  Flag as FlagGlyph,
  Hourglass,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { FLAG_DEFS, FLAG_ORDER, type Flag, type FlagId } from "@/domain/flags";

export const FLAG_ICON: Record<FlagId, LucideIcon> = {
  safety: ShieldAlert,
  slot_at_risk: CalendarX,
  urgent: Siren,
  rule_violation: FileX,
  coverage: CreditCard,
  missing_docs: FileMinus,
  at_risk: Clock,
  over_sla: Hourglass,
};

const TONE = { danger: "text-rose-600", warn: "text-amber-500" } as const;

export function FlagIcon({ id, detail, size = 16 }: { id: FlagId; detail?: string; size?: number }) {
  const def = FLAG_DEFS[id];
  const Icon = FLAG_ICON[id];
  const text = detail ? `${def.label}: ${detail}` : def.label;
  return (
    <span role="img" aria-label={text} title={text} className={`inline-flex ${TONE[def.tone]}`}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** The Flags cell: icons only, most severe first. Hover (or screen reader) gives the detail. */
export function FlagIcons({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {flags.map((f) => (
        <FlagIcon key={f.id} id={f.id} detail={f.detail} />
      ))}
    </div>
  );
}

/** "Flag key" popover so the icons can be learned in one place. */
export function FlagLegend() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        <FlagGlyph size={14} /> Flag key
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[380px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <ul className="space-y-2.5">
            {FLAG_ORDER.map((id) => (
              <li key={id} className="flex items-start gap-3">
                <span className="mt-0.5">
                  <FlagIcon id={id} size={16} />
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-900">{FLAG_DEFS[id].label}</div>
                  <div className="text-xs text-slate-500">{FLAG_DEFS[id].meaning}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

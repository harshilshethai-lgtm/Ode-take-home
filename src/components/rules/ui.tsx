import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import type { Seg } from "@/domain/rules/diff";
import type { CriterionStatus, EvaluationOverall, ExceptionStatus, VersionStatus } from "@/domain/rules/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

type Tone = "slate" | "emerald" | "amber" | "rose" | "sky" | "violet" | "indigo";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function Pill({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const VERSION_TONE: Record<VersionStatus, [Tone, string]> = {
  draft: ["amber", "Draft"],
  scheduled: ["sky", "Scheduled"],
  active: ["emerald", "Active"],
  superseded: ["slate", "Superseded"],
  archived: ["slate", "Archived"],
};
export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const [tone, label] = VERSION_TONE[status];
  return <Pill tone={tone}>{label}</Pill>;
}

const CRITERION_TONE: Record<CriterionStatus, [Tone, string]> = {
  met: ["emerald", "Met"],
  not_met: ["rose", "Not met"],
  unknown: ["amber", "Unknown"],
  needs_review: ["violet", "Needs review"],
  waived: ["sky", "Waived"],
};
export function CriterionStatusBadge({ status }: { status: CriterionStatus }) {
  const [tone, label] = CRITERION_TONE[status];
  return <Pill tone={tone}>{label}</Pill>;
}

const EXCEPTION_TONE: Record<ExceptionStatus, [Tone, string]> = {
  not_triggered: ["slate", "Not triggered"],
  applied: ["sky", "Applied"],
  needs_review: ["violet", "Triggered, needs review"],
};
export function ExceptionStatusBadge({ status }: { status: ExceptionStatus }) {
  const [tone, label] = EXCEPTION_TONE[status];
  return <Pill tone={tone}>{label}</Pill>;
}

export const OVERALL_LABEL: Record<EvaluationOverall, string> = {
  approve_ready: "Ready to approve",
  missing_info: "Missing info",
  not_eligible: "Not eligible",
  needs_review: "Needs review",
  no_policy_found: "No policy found",
};
const OVERALL_TONE: Record<EvaluationOverall, Tone> = {
  approve_ready: "emerald",
  missing_info: "amber",
  not_eligible: "rose",
  needs_review: "violet",
  no_policy_found: "slate",
};
export function OverallBadge({ overall }: { overall: EvaluationOverall }) {
  return <Pill tone={OVERALL_TONE[overall]}>{OVERALL_LABEL[overall]}</Pill>;
}

export function AssumptionBadge({ title = "This rule encodes an assumption, not a stated policy rule." }: { title?: string }) {
  return (
    <Pill tone="amber" title={title}>
      <AlertTriangle size={11} /> Assumption
    </Pill>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};
export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Banner({ tone = "sky", children, action }: { tone?: "sky" | "amber" | "rose" | "emerald"; children: ReactNode; action?: ReactNode }) {
  const styles = {
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div role={tone === "rose" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${styles[tone]}`}>
      {tone === "sky" || tone === "emerald" ? <Info size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`my-6 w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Renders a word diff: removed words struck through in red, added words in green. */
export function DiffText({ segs, side }: { segs: Seg[]; side: "before" | "after" }) {
  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === "same") return <span key={i}>{s.text}</span>;
        const cls =
          side === "before"
            ? "rounded bg-rose-100 px-0.5 text-rose-800 line-through decoration-rose-400"
            : "rounded bg-emerald-100 px-0.5 font-semibold text-emerald-900";
        return (
          <mark key={i} className={`${cls} bg-clip-padding`}>
            {s.text}
          </mark>
        );
      })}
    </>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
      {aside}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{children}</div>;
}

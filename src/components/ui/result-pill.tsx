import { Check, CircleHelp, CornerDownRight, RotateCw, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CheckResult } from "@/domain/review/types";

const TONE = {
  success: "bg-result-success-bg text-result-success",
  danger: "bg-result-danger-bg text-result-danger",
  warning: "bg-result-warning-bg text-result-warning",
  neutral: "bg-chip text-fg-2",
} as const;

export const RESULT_PRESENTATION: Record<CheckResult, { label: string; icon: LucideIcon; tone: keyof typeof TONE }> = {
  MET: { label: "Pass", icon: Check, tone: "success" },
  NOT_MET: { label: "Fail", icon: X, tone: "danger" },
  UNCLEAR: { label: "Unclear", icon: CircleHelp, tone: "warning" },
  WAIVED: { label: "Waived", icon: ShieldCheck, tone: "neutral" },
  EXCEPTION_MET: { label: "Exception", icon: CornerDownRight, tone: "neutral" },
  FIXED: { label: "Fixed", icon: RotateCw, tone: "warning" },
};

/** Result with a word and an icon. Color is never the only signal. */
export function ResultPill({ result }: { result: CheckResult }) {
  const presentation = RESULT_PRESENTATION[result];
  const Icon = presentation.icon;
  return (
    <span className={cn("inline-flex h-5 w-fit items-center gap-1 rounded-md px-2 text-caption", TONE[presentation.tone])}>
      <Icon size={14} aria-hidden />
      {presentation.label}
    </span>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Color means status, nothing else. Five tones, matching .cursor/rules/design.mdc. */
export type StatusTone = "ready" | "hold" | "blocked" | "review" | "neutral";

const TONE_BG: Record<StatusTone, string> = {
  ready: "bg-dot-ready",
  hold: "bg-dot-hold",
  blocked: "bg-dot-blocked",
  review: "bg-dot-review",
  neutral: "bg-dot-neutral",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-dot shrink-0 rounded-full", TONE_BG[tone], className)} />;
}

/** 6px colored dot plus a gray label. The label never takes the color. */
export function StatusLabel({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-body text-label">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

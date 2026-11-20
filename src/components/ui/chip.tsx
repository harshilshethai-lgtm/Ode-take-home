import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tip } from "./tooltip";

/** Neutral chip: gray, 12px. Never colored; color is reserved for status. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      data-chip
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded-md bg-chip px-2 text-caption text-chip-fg",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** At most `max` (2) visible chips, then "+N" with a tooltip listing the rest. */
export function ChipList({ items, max = 2 }: { items: string[]; max?: number }) {
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((t) => (
        <Chip key={t}>{t}</Chip>
      ))}
      {rest.length > 0 && (
        <Tip content={rest.join(", ")}>
          <span data-chip-overflow className="text-caption text-fg-2">
            +{rest.length}
          </span>
        </Tip>
      )}
    </span>
  );
}

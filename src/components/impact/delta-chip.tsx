import { cn } from "@/lib/cn";

const TONE = {
  good: "text-good",
  bad: "text-bad",
  flat: "text-fg-2",
} as const;

/** Signed change versus baseline. Green when the move is the good direction, red when it is not. */
export function DeltaChip({ label, tone }: { label: string; tone: keyof typeof TONE }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md bg-chip px-2 text-caption tabular", TONE[tone])}>
      {label}
    </span>
  );
}

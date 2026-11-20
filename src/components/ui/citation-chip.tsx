import { cn } from "@/lib/cn";
import { Tip } from "./tooltip";

interface Props {
  /** 1-based page in the source PDF. */
  page: number;
  /** Verbatim excerpt, shown on hover. */
  excerpt?: string;
  /** Replaces the default "p.N" text, e.g. "Policy" when the page number would be ambiguous. */
  label?: string;
  onOpen?: () => void;
  className?: string;
}

/** "p.3": opens the source PDF at that page. Every value from a PDF carries one. */
export function CitationChip({ page, excerpt, label, onOpen, className }: Props) {
  return (
    <Tip content={excerpt ? `“${excerpt}”` : `Open page ${page}`}>
      <button
        type="button"
        onClick={onOpen}
        data-chip
        className={cn(
          "inline-flex h-5 items-center rounded-md bg-chip px-1 text-caption text-chip-fg tabular hover:text-accent-fg",
          className,
        )}
      >
        {label ?? `p.${page}`}
      </button>
    </Tip>
  );
}

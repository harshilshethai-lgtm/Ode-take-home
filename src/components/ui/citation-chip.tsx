import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tip } from "./tooltip";

/** Case page supplies this so a fax chip reads "fax p.5" instead of the PDF index. */
const CiteFormatContext = createContext<((page: number) => string) | null>(null);

export function CiteFormatProvider({ format, children }: { format: (page: number) => string; children: ReactNode }) {
  return <CiteFormatContext.Provider value={format}>{children}</CiteFormatContext.Provider>;
}

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
  const format = useContext(CiteFormatContext);
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
        {label ?? (format ? format(page) : `p.${page}`)}
      </button>
    </Tip>
  );
}

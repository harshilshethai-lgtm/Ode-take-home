import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-line bg-panel", className)}>{children}</div>;
}

/** One-line row that expands to a detail block. */
export function ExpandRow({
  summary,
  trailing,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex h-9 w-full items-center gap-2 px-3 text-left text-body hover:bg-hover"
      >
        <ChevronRight size={14} className={cn("shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
        {summary}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </button>
      {open && <div className="animate-collapsible px-4 pb-3 pl-8">{children}</div>}
    </div>
  );
}

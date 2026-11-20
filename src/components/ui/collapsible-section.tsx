import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  title: string;
  /** Shown in secondary gray after the title, e.g. "4/4". */
  count?: string | number;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** 13px/500 header with a chevron and count. Content opens in 140ms. */
export function CollapsibleSection({ title, count, defaultOpen = false, children, className }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={className}>
      <Collapsible.Trigger className="flex h-8 w-full items-center gap-1 text-left text-body font-medium text-fg">
        <ChevronRight size={14} className={cn("text-fg-3 transition-transform", open && "rotate-90")} />
        {title}
        {count !== undefined && <span className="tabular font-normal text-fg-2">{count}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="animate-collapsible">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

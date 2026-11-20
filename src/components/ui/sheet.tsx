import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Secondary-gray count after the title, like "3". */
  count?: number;
  children: ReactNode;
  className?: string;
}

/** Right-side panel. Esc or a click outside closes it. Opens in 140ms; no other motion. */
export function Sheet({ open, onOpenChange, title, count, children, className }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "animate-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-line bg-panel text-body text-fg shadow-sm",
            className,
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
            <Dialog.Title className="text-emph text-fg">
              {title}
              {count !== undefined && <span className="tabular ml-1 font-normal text-fg-2">{count}</span>}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

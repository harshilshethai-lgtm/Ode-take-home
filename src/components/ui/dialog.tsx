import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Right-aligned actions. At most one primary button. */
  footer?: ReactNode;
}

/** Centered modal for short forms. Esc or a click outside closes it. */
export function Modal({ open, onOpenChange, title, children, footer }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="animate-collapsible fixed left-1/2 top-24 z-50 flex max-h-screen w-full max-w-md -translate-x-1/2 flex-col rounded-lg border border-line bg-panel text-body text-fg shadow-sm"
        >
          <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
            <Dialog.Title className="text-emph text-fg">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

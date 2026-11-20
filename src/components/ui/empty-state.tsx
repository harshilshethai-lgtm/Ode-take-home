import type { ReactNode } from "react";

/** One line of gray text plus at most one action. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-body text-fg-2">
      <span>{children}</span>
      {action}
    </div>
  );
}

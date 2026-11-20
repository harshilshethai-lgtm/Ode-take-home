import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Tip } from "./tooltip";

/**
 * The one page title (20px/600). The only component allowed to use text-title.
 * Title only, optionally a secondary-gray count, optionally a lock for read-only. No subtitle.
 */
export function PageTitle({ children, count, readOnly }: { children: ReactNode; count?: number; readOnly?: boolean }) {
  return (
    <h1 className="flex items-center gap-2 text-title text-fg">
      {children}
      {count !== undefined && <span className="tabular font-normal text-fg-2">{count}</span>}
      {readOnly && (
        <Tip content="Read-only">
          <Lock size={14} aria-label="Read-only" className="text-fg-3" />
        </Tip>
      )}
    </h1>
  );
}

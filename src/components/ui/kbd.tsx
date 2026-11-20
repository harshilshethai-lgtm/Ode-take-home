import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-md border border-line bg-chip px-1 font-sans text-caption text-fg-2">
      {children}
    </kbd>
  );
}

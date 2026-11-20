import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Property {
  label: string;
  value: ReactNode;
}

/** Label/value pairs. Label 12px secondary, value 13px. Two columns: label then value. */
export function PropertyList({ items, className }: { items: Property[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-props items-baseline gap-x-4 gap-y-1", className)}>
      {items.map((p) => (
        <div key={p.label} className="contents">
          <dt className="text-caption text-fg-2">{p.label}</dt>
          <dd className="min-w-0 text-body text-fg">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}

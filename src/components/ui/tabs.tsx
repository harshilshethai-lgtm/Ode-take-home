import { cn } from "@/lib/cn";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
  hint?: string;
}

/** Text tabs with secondary-gray counts and an underline on the active one. Each tab is a saved filter. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-4 border-b border-line">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px h-8 whitespace-nowrap border-b-2 text-body transition-colors",
              active ? "border-accent font-medium text-fg" : "border-transparent text-fg-2 hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular ml-1 font-normal text-fg-2">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

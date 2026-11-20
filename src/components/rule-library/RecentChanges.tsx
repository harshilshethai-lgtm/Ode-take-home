import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card } from "@/components/ui/card";
import type { RecentPublish } from "@/data/rules/service";
import { fmtLongDate } from "@/lib/ruleCard";

interface Props {
  items: RecentPublish[];
  /** Open the diff for this publish (or the version itself when it has no predecessor). */
  onOpen: (item: RecentPublish) => void;
}

/** The last publishes across every payer. Each row opens the diff. */
export function RecentChanges({ items, onOpen }: Props) {
  if (items.length === 0) return null;
  return (
    <Card className="mb-4 px-3">
      <CollapsibleSection title="Recent changes" count={items.length} defaultOpen>
        <div className="-mx-3 border-t border-line">
          {items.map((r) => (
            <button
              key={r.versionId}
              type="button"
              onClick={() => onOpen(r)}
              className="flex h-9 w-full items-center gap-2 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-hover"
            >
              <span className="shrink-0 whitespace-nowrap text-fg">
                {r.payerName} · <span className="tabular">{r.externalPolicyId}</span>
              </span>
              <span className="tabular shrink-0 text-fg-2">v{r.versionNumber}</span>
              <span className="min-w-0 truncate text-fg-2">{r.changeNote ?? "No change note"}</span>
              <span className="tabular ml-auto shrink-0 pl-2 text-caption text-fg-2">
                {fmtLongDate(r.publishedAt.slice(0, 10))} · {r.publishedBy}
              </span>
            </button>
          ))}
        </div>
      </CollapsibleSection>
    </Card>
  );
}

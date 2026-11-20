import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import type { RecentPublish } from "@/data/rules/service";
import { fmtLongDate } from "@/lib/ruleCard";
import { useRules } from "@/lib/useRules";

interface Props {
  items: RecentPublish[];
  /** Open the diff for this publish (or the version itself when it has no predecessor). */
  onOpen: (item: RecentPublish) => void;
}

/** The last publishes across every payer. Each row opens the diff. */
export function RecentChanges({ items, onOpen }: Props) {
  const rules = useRules();
  if (items.length === 0) return null;
  return (
    <Card className="mt-6 px-3">
      <CollapsibleSection title="Recent changes" count={items.length} defaultOpen>
        <div className="-mx-3 border-t border-line">
          {items.map((r) => {
            const revision = rules.getPolicy(r.policyId).versions.find((version) => version.id === r.versionId)?.sourceRevisionLabel;
            const note = r.changeNote ?? "No change note";
            return (
              <button
                key={r.versionId}
                type="button"
                onClick={() => onOpen(r)}
                className="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left text-body last:border-b-0 hover:bg-hover"
              >
                <span className="shrink-0 whitespace-nowrap text-fg">
                  {r.payerName} · <span className="tabular">{r.externalPolicyId}</span>
                </span>
                <span className="shrink-0 tabular text-fg-2">
                  {revision ? `${revision} ` : ""}(v{r.versionNumber})
                </span>
                <Tip content={note}>
                  <span className="line-clamp-2 min-w-0 flex-1 text-fg-2">{note}</span>
                </Tip>
                <span className="ml-auto shrink-0 pl-2 text-caption tabular text-fg-2">
                  {fmtLongDate(r.publishedAt.slice(0, 10))} · {r.publishedBy}
                </span>
              </button>
            );
          })}
        </div>
      </CollapsibleSection>
    </Card>
  );
}

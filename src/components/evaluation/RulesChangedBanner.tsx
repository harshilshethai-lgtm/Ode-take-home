import { Button } from "@/components/ui/button";
import type { Staleness } from "@/domain/rules/staleness";
import { affectedList, rulesChangedText } from "@/lib/evalNotice";

/** Shown when a newer rule version now applies to the service date. Lists what changed and offers a re-run. */
export function RulesChangedBanner({ staleness, onRerun }: { staleness: Staleness; onRerun: () => void }) {
  const { pinned, applicable, affected, affectedWaivers } = staleness;
  return (
    <div role="status" className="mb-2 rounded-lg border border-line bg-chip px-3 py-2 text-body text-fg">
      <div className="flex min-h-7 items-center gap-2">
        <span>{rulesChangedText(pinned.versionNumber, applicable.versionNumber, affected, affectedWaivers)}</span>
        <Button variant="link" onClick={onRerun} className="ml-auto shrink-0">
          Re-run →
        </Button>
      </div>
      {affected.length > 0 && <div className="text-caption text-fg-2">Changed: {affectedList(affected)}</div>}
      {affectedWaivers.length > 0 && <div className="text-caption text-fg-2">Waivers: {affectedList(affectedWaivers)}</div>}
    </div>
  );
}

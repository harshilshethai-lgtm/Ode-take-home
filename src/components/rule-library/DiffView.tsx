// A plain-English diff between two versions, matched by criterion key. Added is green, removed is red and
// struck through, changed shows "old → new" with the new value in bold.

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { diffWords, type CriterionDiff, type ExceptionDiff, type Seg, type ValueChange, type VersionDiff } from "@/domain/rules/diff";
import { cn } from "@/lib/cn";
import { diffInline } from "@/lib/diffInline";

type Kind = "added" | "removed" | "changed";

const TAG: Record<Kind, { text: string; cls: string }> = {
  added: { text: "Added", cls: "text-green-600" },
  removed: { text: "Removed", cls: "text-red-500" },
  changed: { text: "Changed", cls: "text-fg-2" },
};

function Tag({ kind }: { kind: Kind }) {
  return <span className={cn("w-16 shrink-0 text-caption font-medium", TAG[kind].cls)}>{TAG[kind].text}</span>;
}

function Segments({ segs, side }: { segs: Seg[]; side: "from" | "to" }) {
  return (
    <>
      {segs.map((s, i) =>
        s.kind === "same" ? (
          <span key={i}>{s.text}</span>
        ) : side === "to" ? (
          <strong key={i} className="font-semibold text-fg">
            {s.text}
          </strong>
        ) : (
          <span key={i} className="line-through">
            {s.text}
          </span>
        ),
      )}
    </>
  );
}

/** "Min weeks: 4 → 6", with the 6 in bold. */
function ChangeLine({ change }: { change: ValueChange }) {
  const long = change.label.startsWith("Citation") && change.label.endsWith("excerpt");
  if (long) return <div className="text-body text-fg-2">Source excerpt reworded</div>;
  const d = diffInline(change.from, change.to);
  return (
    <div className="text-body text-fg-2">
      {change.label}: <Segments segs={d.from} side="from" /> → <span className="text-fg"><Segments segs={d.to} side="to" /></span>
    </div>
  );
}

function Row({ kind, title, children }: { kind: Kind; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex gap-2 border-b border-line px-4 py-2 last:border-b-0">
      <Tag kind={kind} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className={cn("text-body", kind === "removed" ? "text-fg-2 line-through" : "text-fg")}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function CriterionRow({ c }: { c: CriterionDiff }) {
  if (c.kind === "added") {
    return (
      <Row kind="added" title={c.label}>
        <div className="text-body text-fg-2">{c.after?.text}</div>
      </Row>
    );
  }
  if (c.kind === "removed") {
    return (
      <Row kind="removed" title={c.label}>
        <div className="text-body text-fg-2 line-through">{c.before?.text}</div>
      </Row>
    );
  }
  const was = c.before?.displayLabel ?? c.label;
  const title =
    was === c.label ? (
      c.label
    ) : (
      <>
        <Segments segs={diffWords(was, c.label).before} side="from" /> → <Segments segs={diffWords(was, c.label).after} side="to" />
      </>
    );
  // The label already says it when it was the only thing that changed.
  const rows = c.changes.filter((x) => x.label !== "Label");
  return (
    <Row kind="changed" title={title}>
      {rows.map((x) => (
        <ChangeLine key={x.label} change={x} />
      ))}
      {c.citationChanges.map((x) => (
        <ChangeLine key={x.label} change={x} />
      ))}
    </Row>
  );
}

function WaiverRow({ w }: { w: ExceptionDiff }) {
  if (w.kind === "added") {
    return (
      <Row kind="added" title={w.label}>
        <div className="text-body text-fg-2">{w.afterText}</div>
      </Row>
    );
  }
  if (w.kind === "removed") {
    return (
      <Row kind="removed" title={w.label}>
        <div className="text-body text-fg-2 line-through">{w.beforeText}</div>
      </Row>
    );
  }
  const rows = w.changes.filter((x) => x.label !== "Label");
  return (
    <Row kind="changed" title={w.label}>
      {rows.map((x) => (
        <ChangeLine key={x.label} change={x} />
      ))}
      {w.citationChanges.map((x) => (
        <ChangeLine key={x.label} change={x} />
      ))}
    </Row>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line last:border-b-0">
      <h2 className="px-4 pb-1 pt-3 text-body font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Lines({ changes }: { changes: ValueChange[] }) {
  return (
    <div className="flex flex-col gap-1 px-4 pb-3">
      {changes.map((c) => (
        <ChangeLine key={c.label} change={c} />
      ))}
    </div>
  );
}

export function DiffView({ diff }: { diff: VersionDiff }) {
  const criteria = diff.criteria.filter((c) => c.kind !== "unchanged");
  const waivers = diff.exceptions.filter((e) => e.kind !== "unchanged");
  const unchanged = diff.criteria.length - criteria.length;
  const nothing = criteria.length + waivers.length + diff.applicability.length + diff.properties.length + diff.source.length === 0;
  if (nothing) return <EmptyState>No differences</EmptyState>;

  return (
    <div>
      {criteria.length > 0 && (
        <Section title="Criteria">
          {criteria.map((c) => (
            <CriterionRow key={c.key} c={c} />
          ))}
          {unchanged > 0 && <div className="px-4 pb-3 text-caption text-fg-3">{unchanged} unchanged</div>}
        </Section>
      )}
      {waivers.length > 0 && (
        <Section title="Waivers">
          {waivers.map((w) => (
            <WaiverRow key={w.key} w={w} />
          ))}
        </Section>
      )}
      {diff.applicability.length > 0 && (
        <Section title="Applies to">
          <Lines changes={diff.applicability} />
        </Section>
      )}
      {diff.properties.length > 0 && (
        <Section title="Policy properties">
          <Lines changes={diff.properties} />
        </Section>
      )}
      {diff.source.length > 0 && (
        <Section title="Source">
          <Lines changes={diff.source} />
        </Section>
      )}
    </div>
  );
}

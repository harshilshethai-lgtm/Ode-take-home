import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StatusDot, StatusLabel } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import type { VersionView } from "@/data/rules/service";
import { cn } from "@/lib/cn";
import { VERSION_STATUS_LABEL, label } from "@/lib/labels";
import { publishedLine, rangeLabel, type PropertyRow } from "@/lib/ruleCard";

/** Amber triangle with a count. Assumptions are things to confirm with the payer, so they read as a warning. */
export function AssumptionCount({ count }: { count: number }) {
  if (count === 0) return null;
  const text = `${count} ${count === 1 ? "assumption" : "assumptions"} to confirm with the payer`;
  return (
    <Tip content={text}>
      <span role="img" aria-label={text} className="inline-flex items-center gap-1 text-caption text-fg-2">
        <TriangleAlert size={14} className="text-amber-500" />
        <span className="tabular">{count}</span>
      </span>
    </Tip>
  );
}

export function Assumption({ note }: { note: string }) {
  return (
    <div className="mb-2 flex items-start gap-2 text-body text-fg-2">
      <StatusLabel tone="hold">Assumption</StatusLabel>
      <span className="min-w-0">{note}</span>
    </div>
  );
}

/** Amber dot beside a row that carries an assumption. The note is inside the row. */
export function AssumptionDot() {
  return (
    <Tip content="Assumption">
      <span className="inline-flex">
        <StatusDot tone="hold" />
      </span>
    </Tip>
  );
}

/** "Duration ...... 6 weeks". An assumed value gets an amber dot and its note underneath. */
export function PropertyRows({ rows, className }: { rows: PropertyRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {rows.map((r) => (
        <li key={r.key} data-property={r.key}>
          <div className="flex items-baseline gap-2 text-body">
            <span className="shrink-0 text-fg-2">{r.label}</span>
            <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-line" />
            <span className="min-w-0 text-right text-fg">{r.value}</span>
            {r.assumption && <AssumptionDot />}
          </div>
          {r.assumption && <div className="text-caption text-fg-2">{r.assumption}</div>}
        </li>
      ))}
    </ul>
  );
}

/** The insurer's verbatim text, collapsed. Never the main text of a row. */
export function SourceToggle({ reference, excerpt }: { reference: string; excerpt: string }) {
  return (
    <CollapsibleSection title={`Source · ${reference || "no reference"}`} className="mt-1">
      <blockquote className="mb-1 border-l-2 border-line pl-3 text-body text-fg-2">{excerpt || "No source text."}</blockquote>
    </CollapsibleSection>
  );
}

const VERSION_TONE = { active: "ready", draft: "hold" } as const;
export const versionTone = (status: string) => VERSION_TONE[status as keyof typeof VERSION_TONE] ?? "neutral";

interface VersionItemProps {
  version: VersionView;
  selected: boolean;
  onSelect: () => void;
  /** Actions under the row. Omit while picking a version to compare with. */
  actions?: ReactNode;
}

export function VersionItem({ version: x, selected, onSelect, actions }: VersionItemProps) {
  return (
    <div className={cn("border-l-2", selected ? "border-accent bg-hover" : "border-transparent")}>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className="flex w-full flex-col gap-1 px-4 pt-3 text-left hover:bg-hover">
        <span className="flex items-center gap-2">
          <span className="tabular text-emph text-fg">v{x.versionNumber}</span>
          <StatusLabel tone={versionTone(x.derivedStatus)}>{label(VERSION_STATUS_LABEL, x.derivedStatus)}</StatusLabel>
          <span className="tabular ml-auto text-caption text-fg-2">{rangeLabel(x)}</span>
        </span>
        <span className="text-body text-fg">{x.changeNote ?? "No change note yet"}</span>
        <span className="pb-2 text-caption text-fg-2">{publishedLine(x)}</span>
      </button>
      <div className="flex min-h-7 items-center gap-1 px-3 pb-2">{actions}</div>
    </div>
  );
}

/** "Priya Nair, RN" -> "Priya". */
export function firstName(name: string): string {
  return name.split(/[\s,]/)[0] || name;
}

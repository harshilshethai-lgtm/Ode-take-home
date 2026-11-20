import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleDashed, CircleDot, Shield, X, type LucideIcon } from "lucide-react";
import { CitationChip } from "@/components/ui/citation-chip";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SourceTag } from "@/components/ui/source-tag";
import type { ChecklistModel, CriterionRowModel, DataCheckModel, EvidenceLine } from "@/domain/checklistView";
import { checkedLine } from "@/domain/checklistView";
import type { CriterionStatus } from "@/domain/rules/types";
import { CRITERION_STATUS_LABEL, label } from "@/lib/labels";

interface OpenPage {
  docId: string;
  page: number;
  quote?: string;
}

const MARK: Record<CriterionStatus, { Icon: LucideIcon; className: string }> = {
  met: { Icon: Check, className: "text-good" },
  not_met: { Icon: X, className: "text-bad" },
  unknown: { Icon: CircleDashed, className: "text-warning" },
  needs_review: { Icon: CircleDot, className: "text-violet-500" },
  waived: { Icon: Shield, className: "text-fg-3" },
};

export function StatusMark({ status, tag, close }: { status: CriterionStatus; tag?: string | null; close?: boolean }) {
  const { Icon, className } = MARK[status];
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1 text-body text-label">
        <Icon size={16} className={className} aria-hidden="true" />
        {label(CRITERION_STATUS_LABEL, status)}
      </span>
      {tag && <span className="text-caption text-fg-2">{tag}</span>}
      {close && <span className="text-caption text-warning">Close to threshold</span>}
    </div>
  );
}

export function ChecklistCard({ model, onOpen }: { model: ChecklistModel; onOpen: (cite: OpenPage) => void }) {
  if (!model.criteria && !model.dataChecks && !model.verdict) return null;
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <h2 className="text-block text-fg">Checklist</h2>
      {model.verdict && <div className="mt-2 text-body text-fg">{model.verdict}</div>}
      {model.criteria && (
        <CollapsibleSection title="Insurer criteria" count={model.criteria.count} defaultOpen={model.criteria.defaultOpen} className="mt-2">
          {model.waiting && <div className="py-2 text-body text-fg-2">{model.waiting}</div>}
          {model.criteria.rows.map((row) => (
            <CriterionRow key={row.id} row={row} onOpen={onOpen} />
          ))}
        </CollapsibleSection>
      )}
      {model.dataChecks && (
        <CollapsibleSection title="Data checks" count={model.dataChecks.count} defaultOpen={model.dataChecks.defaultOpen} className="mt-2">
          {model.dataChecks.rows.map((row) => (
            <DataCheckRow key={row.id} row={row} onOpen={onOpen} />
          ))}
        </CollapsibleSection>
      )}
      {model.policyLabel && model.policyHref && (
        <div className="mt-4 border-t border-line pt-4">
          <Link to={model.policyHref} className="text-caption text-accent-fg">
            {model.policyLabel}
          </Link>
        </div>
      )}
    </section>
  );
}

function CriterionRow({ row, onOpen }: { row: CriterionRowModel; onOpen: (cite: OpenPage) => void }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(row.excerpt || row.reason || row.fix || row.evidence.length);
  return (
    <div className="border-t border-line py-2 first:border-t-0">
      <div className="flex items-start gap-3">
        {expandable ? (
          <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <RowText label={row.label} fact={row.fact} />
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <RowText label={row.label} fact={row.fact} />
          </div>
        )}
        <StatusMark status={row.status} tag={row.tag} close={row.close} />
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-4">
          {row.excerpt && (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 text-body text-fg-2">{row.excerpt}</div>
              {row.policyCite && (
                <CitationChip
                  label="Policy"
                  page={row.policyCite.page}
                  excerpt={row.policyCite.quote}
                  onOpen={() => onOpen({ docId: row.policyCite!.docId, page: row.policyCite!.page, quote: row.policyCite!.quote })}
                />
              )}
            </div>
          )}
          {row.evidence.map((line, index) => (
            <EvidenceLineView key={`${row.id}-${index}`} line={line} onOpen={onOpen} />
          ))}
          {row.reason && <div className="text-body text-fg-2">{row.reason}</div>}
          {row.fix && <div className="text-body text-fg">{row.fix}</div>}
        </div>
      )}
    </div>
  );
}

function DataCheckRow({ row, onOpen }: { row: DataCheckModel; onOpen: (cite: OpenPage) => void }) {
  return (
    <div className="flex items-start gap-3 border-t border-line py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <RowText label={row.label} fact={row.fact} />
      </div>
      {row.cite && (
        <CitationChip page={row.cite.page} excerpt={row.cite.quote} onOpen={() => onOpen({ docId: row.cite!.docId, page: row.cite!.page, quote: row.cite!.quote })} />
      )}
      {row.epic && <SourceTag system="epic" lastRun={row.epic.lastRun} />}
      <StatusMark status={row.status} />
    </div>
  );
}

function RowText({ label, fact }: { label: string; fact: string }) {
  return (
    <>
      <div className="text-body text-fg">{label}</div>
      {fact && <div className="text-caption text-fg-2">{fact}</div>}
    </>
  );
}

export function EvidenceCard({ lines, onOpen }: { lines: EvidenceLine[]; onOpen: (cite: OpenPage) => void }) {
  if (lines.length === 0) return null;
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-block text-fg">Evidence</h2>
        <span className="tabular text-body text-fg-2">{lines.length}</span>
      </div>
      {lines.map((line, index) => (
        <div key={`${line.source}-${index}`} className="border-t border-line py-3 first:border-t-0">
          <EvidenceLineView line={line} onOpen={onOpen} />
        </div>
      ))}
    </section>
  );
}

function EvidenceLineView({ line, onOpen }: { line: EvidenceLine; onOpen: (cite: OpenPage) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-caption text-fg-2">{line.source}</div>
        <div className="text-body text-fg">{line.value}</div>
        {line.checked && <div className="text-caption text-fg-2">{checkedLine(line.checked.system, line.checked.lastRun)}</div>}
      </div>
      {line.cite && (
        <CitationChip
          page={line.cite.page}
          excerpt={line.cite.quote}
          onOpen={() => onOpen({ docId: line.cite!.docId, page: line.cite!.page, quote: line.cite!.quote })}
        />
      )}
    </div>
  );
}

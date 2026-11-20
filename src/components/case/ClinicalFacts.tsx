import { useState } from "react";
import { CitationChip } from "@/components/ui/citation-chip";
import type { ClinicalFactsModel, PaneCite } from "@/domain/casePane";

interface OpenPage {
  docId: string;
  page: number;
  quote?: string;
}

function dayNum(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function monthDay(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function FactCite({ cite, onOpen }: { cite: PaneCite; onOpen: (cite: OpenPage) => void }) {
  return (
    <CitationChip
      docId={cite.docId}
      page={cite.page}
      label={cite.label}
      excerpt={cite.quote}
      onOpen={() => onOpen({ docId: cite.docId, page: cite.page, quote: cite.quote })}
    />
  );
}

/** Treatment bars from onset to the scan, with the policy duration marked. */
export function ClinicalFacts({ model, onOpen }: { model: ClinicalFactsModel; onOpen: (cite: OpenPage) => void }) {
  const dates = [model.onset, model.scan, model.threshold ?? "", ...model.treatments.flatMap((bar) => [bar.start, bar.end])].filter(Boolean);
  const start = Math.min(...dates.map(dayNum));
  const span = Math.max(Math.max(...dates.map(dayNum)) - start, 1);
  const pct = (iso: string) => ((dayNum(iso) - start) / span) * 100;
  const marks = [
    { iso: model.onset, label: monthDay(model.onset) },
    ...(model.threshold ? [{ iso: model.threshold, label: model.thresholdLabel }] : []),
    { iso: model.scan, label: monthDay(model.scan) },
  ].filter((mark) => mark.iso);

  const [open, setOpen] = useState(model.open);
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <button type="button" className="flex w-full items-baseline justify-between gap-4 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="text-block text-fg">Clinical facts</span>
        <span className="text-body text-fg-2">{model.summary}</span>
      </button>
      {open && (
        <div className="mt-4">
          {model.treatments.length > 0 && (
            <div className="mb-4">
              <div className="relative mb-2">
                {model.threshold && <div className="absolute bottom-0 top-0 w-px bg-fg" style={{ left: `${pct(model.threshold)}%` }} />}
                {model.treatments.map((bar) => {
                  const left = pct(bar.start);
                  const width = Math.max(pct(bar.end) - left, 1.5);
                  return (
                    <div key={bar.name} data-row className="flex items-center gap-2 py-1">
                      <div className="w-16 text-body text-fg">{bar.name}</div>
                      <div className="relative h-4 min-w-0 flex-1">
                        <div className="absolute inset-x-0 top-2 h-px bg-line" />
                        <div className="absolute top-1 h-2 rounded-md bg-chip" style={{ left: `${left}%`, width: `${width}%` }} />
                      </div>
                      <FactCite cite={bar.cite} onOpen={onOpen} />
                    </div>
                  );
                })}
              </div>
              <div className="relative h-4 text-caption text-fg-3">
                {marks.map((mark) => (
                  <span key={`${mark.label}-${mark.iso}`} className="absolute" style={{ left: `${pct(mark.iso)}%` }}>
                    {mark.label}
                  </span>
                ))}
              </div>
              {model.treatments.map((bar) => (
                <div key={`${bar.name}-note`} className="text-caption text-fg-2">
                  {bar.name} · {bar.note}
                </div>
              ))}
              {model.undated.map((fact) => (
                <div key={fact.text} data-row className="mt-2 flex items-start justify-between gap-2">
                  <span className="text-body text-fg">{fact.text}</span>
                  <FactCite cite={fact.cite} onOpen={onOpen} />
                </div>
              ))}
            </div>
          )}
          <FactGroup title="Imaging" rows={model.imaging} onOpen={onOpen} />
          <FactGroup title="Exam" rows={model.exam} onOpen={onOpen} />
          {model.redFlags.length > 0 && (
            <div className="mt-3">
              <div className="text-caption text-fg-2">Red flags</div>
              {model.redFlags.map((row) => (
                <div key={row.id} data-row className="flex items-start justify-between gap-2 border-t border-line py-2">
                  <div className="min-w-0">
                    <div className="text-body text-fg">{row.trigger}</div>
                    <div className="text-caption text-fg-2">{row.status}</div>
                  </div>
                  {row.cite && <FactCite cite={row.cite} onOpen={onOpen} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function FactGroup({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: Array<{ text: string; cite: PaneCite }>;
  onOpen: (cite: OpenPage) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-caption text-fg-2">{title}</div>
      {rows.map((row) => (
        <div key={row.text} data-row className="flex items-start justify-between gap-2 border-t border-line py-2">
          <span className="text-body text-fg">{row.text}</span>
          <FactCite cite={row.cite} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

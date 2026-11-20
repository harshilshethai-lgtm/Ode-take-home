import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Sheet } from "@/components/ui/sheet";
import {
  ASSUMPTION_FIELDS,
  DENIAL_MINUTES,
  INPUT_SOURCE_LABEL,
  METRICS,
  NURSE_REVIEW_MINUTES,
  SOURCE_LABEL,
  type Assumptions,
} from "@/data/impact/metrics";
import type { ImpactModel } from "@/domain/impact/compute";
import { exactMoney, formatMetric, leverFormula } from "@/domain/impact/format";

export function AssumptionsForm({
  value,
  onChange,
  model,
}: {
  value: Assumptions;
  onChange: (next: Assumptions) => void;
  model: ImpactModel;
}) {
  const [open, setOpen] = useState(false);
  const fixed = fixedInputs();
  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Assumptions
        </Button>
        <span className="text-caption text-fg-3">{fixed.length + ASSUMPTION_FIELDS.length} inputs</span>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="Assumptions" count={fixed.length + ASSUMPTION_FIELDS.length}>
        <section className="border-b border-line px-4 py-3">
          <h2 className="text-caption text-fg-3">Inputs</h2>
          <ul className="mt-2 flex flex-col">
            {fixed.map((row) => (
              <li key={row.label} className="flex flex-wrap items-baseline gap-2 border-b border-line py-2 last:border-b-0">
                <span className="text-body text-fg">{row.label}</span>
                <Chip>{row.source}</Chip>
                <span className="ml-auto tabular text-body text-fg">{row.value}</span>
                <span className="w-full text-caption text-fg-3">{row.detail}</span>
              </li>
            ))}
            {ASSUMPTION_FIELDS.map((field) => (
              <li key={field.key} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
                <span className="text-body text-fg">{field.label}</span>
                <Chip>{INPUT_SOURCE_LABEL[field.source]}</Chip>
                <span className="ml-auto inline-flex items-center gap-1">
                  {field.prefix && <span className="text-caption text-fg-3">{field.prefix}</span>}
                  <NumberField
                    label={field.label}
                    value={value[field.key]}
                    onChange={(next) => onChange({ ...value, [field.key]: next })}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="px-4 py-3">
          <h2 className="text-caption text-fg-3">Formulas</h2>
          <ul className="mt-2 flex flex-col">
            {model.cards.map((view) => (
              <li key={view.metric.id} className="border-b border-line py-2 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-body text-fg">{view.metric.lever ?? view.metric.name}</span>
                  <span className="ml-auto text-right text-caption text-fg-2">{view.annualLine}</span>
                </div>
                {view.annualDollars != null && (
                  <div className="text-right text-caption tabular text-fg-3">{exactMoney(view.annualDollars)}</div>
                )}
                <div className="text-caption text-fg-3">
                  {leverFormula(view.metric, view.reading.value, view.baseline, value)}
                </div>
              </li>
            ))}
            <li className="py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-body text-fg">Run rate</span>
                <span className="ml-auto tabular text-caption text-fg-2">
                  {model.runRate == null ? "—" : `${exactMoney(model.runRate)}/yr`}
                </span>
              </div>
              <div className="text-caption text-fg-3">Sum of the dollar lines above. {model.runRateNote}.</div>
            </li>
          </ul>
        </section>
      </Sheet>
    </>
  );
}

function fixedInputs(): { label: string; value: string; source: string; detail: string }[] {
  const lost = METRICS.lost_scan_rate;
  return [
    {
      label: "Nurse review",
      value: `${NURSE_REVIEW_MINUTES} min`,
      source: SOURCE_LABEL.brief,
      detail: "Minutes a nurse spends on one review.",
    },
    {
      label: "Denial baseline",
      value: formatMetric(METRICS.denial_rate, METRICS.denial_rate.baseline ?? 0),
      source: SOURCE_LABEL.brief,
      detail: "Share of decided requests that are denied.",
    },
    {
      label: "Minutes per denial",
      value: `${DENIAL_MINUTES} min`,
      source: SOURCE_LABEL.brief,
      detail: "11% denials × 25 min each.",
    },
    {
      label: "Coordinator baseline",
      value: formatMetric(METRICS.coord_minutes, METRICS.coord_minutes.baseline ?? 0),
      source: SOURCE_LABEL.brief,
      detail: "Receive, check, gather and submit.",
    },
    {
      label: "Lost-scan baseline",
      value: "Shadow weeks 0–2",
      source: SOURCE_LABEL.measured,
      detail: lost.baselineDetail,
    },
    {
      label: "Wrong-call baseline",
      value: "Shadow weeks 0–2",
      source: SOURCE_LABEL.measured,
      detail: "Measured. The brief's 5% is either direction.",
    },
  ];
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder="Not set"
      onChange={(event) => {
        const next = event.target.value;
        if (next !== "" && !/^\d*\.?\d{0,2}$/.test(next)) return;
        setText(next);
        if (next === "" || next === ".") onChange(null);
        else onChange(Number(next));
      }}
      className="h-7 w-24 rounded-md border border-line bg-panel px-2 text-right text-body text-fg tabular outline-none placeholder:text-fg-3"
    />
  );
}

import { useMemo, useState } from "react";
import { AssumptionsForm } from "@/components/impact/assumptions-form";
import { DeltaChip } from "@/components/impact/delta-chip";
import { MetricChart } from "@/components/impact/metric-chart";
import { InfoButton, MetricInfo } from "@/components/impact/metric-info";
import { Segmented } from "@/components/impact/segmented";
import { ValueChart } from "@/components/impact/value-chart";
import { Chip } from "@/components/ui/chip";
import { PageTitle } from "@/components/ui/page-title";
import { StatusDot } from "@/components/ui/status-dot";
import { DEFAULT_ASSUMPTIONS, NEEDS_DATA_LABEL, type Assumptions } from "@/data/impact/metrics";
import { PHASES, WEEKS } from "@/data/impact/weeks";
import { buildImpactModel, type MetricView, type RangeId, type ScopeId } from "@/domain/impact/compute";
import { directionCaption, fmtMoney } from "@/domain/impact/format";
import { cn } from "@/lib/cn";

const RANGES: { id: RangeId; label: string }[] = [
  { id: "toDate", label: "Pilot to date" },
  { id: "last4", label: "Last 4 weeks" },
];

const SCOPES: { id: ScopeId; label: string }[] = [
  { id: "pilot", label: "Pilot hospital" },
  { id: "all", label: "All hospitals" },
];

export default function Impact() {
  const [range, setRange] = useState<RangeId>("toDate");
  const [scope, setScope] = useState<ScopeId>("all");
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const model = useMemo(
    () => buildImpactModel(WEEKS, range, scope, assumptions),
    [range, scope, assumptions],
  );

  return (
    <main className="mx-auto w-full min-w-0 max-w-impact p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PageTitle>Pilot impact</PageTitle>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
          <Segmented label="Hospitals" value={scope} options={SCOPES} onChange={setScope} />
          <Chip>Illustrative data</Chip>
          <span className="inline-flex items-center gap-1 text-caption text-fg-3">
            Shadow → Assisted → Expand
            <InfoButton label="Pilot phases">
              <div className="flex flex-col gap-2">
                {PHASES.map((phase) => (
                  <div key={phase.id}>
                    <div className="text-fg">{phase.label}</div>
                    <div>{phase.note}</div>
                  </div>
                ))}
              </div>
            </InfoButton>
          </span>
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center gap-1">
          <h2 className="text-section text-fg">{model.north.metric.name}</h2>
          <MetricInfo metric={model.north.metric} baseline={model.north.baseline} />
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="text-metric tabular text-fg">{model.north.valueText}</span>
          {model.north.delta && <DeltaChip label={model.north.delta} tone={model.north.tone} />}
          <span className="text-caption text-fg-3">{model.north.window}</span>
        </div>
        <div className="mt-4 h-64 min-w-0">
          <MetricChart
            metric={model.north.metric}
            rows={WEEKS}
            scope={scope}
            baseline={model.north.baseline}
            target={model.north.target}
          />
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {model.guardrails.map((guard) => (
            <li key={guard.metric.id} className="flex items-start gap-2 text-caption text-fg-2">
              {guard.breached && (
                <span className="mt-1">
                  <StatusDot tone="blocked" />
                </span>
              )}
              <span className="min-w-0">
                {guard.text} <span className="text-fg-3">{guard.window}</span>
              </span>
              <MetricInfo metric={guard.metric} baseline={guard.baseline} />
              {guard.breached && <span className="sr-only">Breached</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6 rounded-lg border border-line bg-panel p-4">
        <h2 className="text-section text-fg">Value to date</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            {model.total == null ? (
              <div className="text-section text-fg-3">{NEEDS_DATA_LABEL}</div>
            ) : (
              <div className="text-metric tabular text-fg">{fmtMoney(model.total)}</div>
            )}
            <div className="text-caption text-fg-3">Since week 0</div>
          </div>
          <div>
            <div className={cn("text-section tabular", model.runRate == null ? "text-fg-3" : "text-fg")}>
              {model.runRate == null ? NEEDS_DATA_LABEL : `${fmtMoney(model.runRate)}/yr`}
            </div>
            <div className="text-caption text-fg-3">{model.runRateNote}</div>
          </div>
        </div>
        {model.stack.length > 0 && (
          <div className="mt-4 h-56 min-w-0">
            <ValueChart series={model.series} stack={model.stack} />
          </div>
        )}
        {model.levers.some((lever) => lever.cumulative == null) && (
          <ul className="mt-3 flex flex-col gap-1">
            {model.levers
              .filter((lever) => lever.cumulative == null)
              .map((lever) => (
                <li key={lever.id} className="text-caption text-fg-3">
                  {lever.name} · {NEEDS_DATA_LABEL}
                </li>
              ))}
          </ul>
        )}
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-6">
        {model.cards.map((view) => (
          <MetricCard key={view.metric.id} view={view} scope={scope} />
        ))}
      </div>

      <AssumptionsForm value={assumptions} onChange={setAssumptions} model={model} />
    </main>
  );
}

function MetricCard({ view, scope }: { view: MetricView; scope: ScopeId }) {
  const needs = view.annualLine === NEEDS_DATA_LABEL;
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-line bg-panel p-4 lg:col-span-2">
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 text-body font-semibold text-fg">{view.metric.name}</h2>
        <MetricInfo metric={view.metric} baseline={view.baseline} />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-section tabular text-fg">{view.valueText}</span>
        {view.delta && <DeltaChip label={view.delta} tone={view.tone} />}
        <span className="text-caption text-fg-3">{view.window}</span>
      </div>
      <div className="text-caption text-fg-3">{directionCaption(view.metric.direction)}</div>
      <div className={cn("mt-1 text-caption", needs ? "text-fg-3" : "text-fg-2")}>{view.annualLine}</div>
      {view.reading.partial && view.metric.lagNote && (
        <div className="text-caption text-fg-3">{view.metric.lagNote}</div>
      )}
      <div className="mt-3 h-36 min-w-0">
        <MetricChart
          metric={view.metric}
          rows={WEEKS}
          scope={scope}
          baseline={view.baseline}
          target={view.target}
        />
      </div>
    </article>
  );
}

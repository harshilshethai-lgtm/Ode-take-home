import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Sparkline } from "@/components/operations/sparkline";
import { ConceptInfo, InfoButton, MetricInfo } from "@/components/impact/metric-info";
import { Segmented } from "@/components/impact/segmented";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageTitle } from "@/components/ui/page-title";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { METRICS, OPS_METRICS, type MetricDef, type MetricSpec } from "@/data/impact/metrics";
import { WEEKS } from "@/data/impact/weeks";
import { readMetric, readingBaseline } from "@/domain/impact/compute";
import { formatMetric } from "@/domain/impact/format";
import {
  buildOperations,
  scopeOptions,
  trackTone,
  type AttentionItem,
  type OperationsScope,
  type Period,
  type QueueRowModel,
} from "@/domain/operations/model";
import { fmtBusiness } from "@/domain/operations/time";
import { AUTONOMY_LABEL } from "@/data/operations/queue";
import { fmtTableDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOrders } from "@/lib/useWorklistState";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

const TRACK: Record<StatusTone, string> = {
  ready: "On track",
  hold: "Near target",
  blocked: "Off track",
  review: "Near target",
  neutral: "No reading",
};

const PERCENT = { unit: "percent" as const };

export default function Operations() {
  const navigate = useNavigate();
  const { orders } = useOrders();
  const [hospital, setHospital] = useState<string | null>(null);
  const [insurer, setInsurer] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const options = useMemo(() => scopeOptions(orders), [orders]);
  const scope: OperationsScope = { hospital, insurer, period };
  const model = useMemo(() => buildOperations(orders, scope), [orders, hospital, insurer, period]);

  const attention = model.attention;
  const columns: Column<AttentionItem>[] = [
    {
      id: "due",
      header: "Due",
      cell: (row) => (
        <span className={cn("inline-flex items-center gap-1 tabular", row.pastDue && "text-bad")}>
          {row.slotAtRisk && <span>!</span>}
          {row.dueText}
        </span>
      ),
    },
    {
      id: "slot",
      header: "Scan slot",
      cell: (row) =>
        row.slotText ? <span className="tabular">{fmtTableDate(new Date(row.slotText))}</span> : <span className="text-fg-3">—</span>,
    },
    {
      id: "patient",
      header: "Patient",
      cell: (row) => <span className="font-medium text-fg">{row.patient}</span>,
    },
    { id: "scan", header: "Scan", cell: (row) => row.scan },
    { id: "insurer", header: "Insurer", cell: (row) => row.insurer },
    { id: "owner", header: "Owner", cell: (row) => row.owner },
    {
      id: "why",
      header: "Why",
      cell: (row) => <span className="block max-w-64 truncate text-fg-2">{row.why}</span>,
    },
    {
      id: "open",
      header: "Open",
      width: "w-8",
      headerCell: <span className="sr-only">Open</span>,
      cell: () => <ChevronRight size={14} className="text-fg-3" aria-hidden />,
    },
  ];

  const done =
    model.doneToday.length > 0
      ? `Done today: ${model.doneToday.map((part) => `${part.count} ${part.label}`).join(" · ")}`
      : "Done today: none";

  return (
    <main className="mx-auto w-full min-w-0 max-w-impact p-6">
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <PageTitle>Operations</PageTitle>
        <Chip>Illustrative data</Chip>
        <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
          <ScopeSelect
            label="Hospitals"
            value={hospital}
            allLabel="All hospitals"
            options={options.hospitals}
            onChange={setHospital}
          />
          <ScopeSelect
            label="Insurers"
            value={insurer}
            allLabel="All insurers"
            options={options.insurers}
            onChange={setInsurer}
            wide
          />
          <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
          <span className="text-caption text-fg-3">{model.updated}</span>
          <Link to="/impact" className="inline-flex h-7 items-center text-body text-accent-fg">
            Trends and value → Impact
          </Link>
        </div>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {model.tiles.map((tile) => (
          <ScoreTileView key={tile.metric.name} tile={tile} />
        ))}
      </section>

      <section className="mb-6">
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1">
            <h2 className="text-section text-fg">Where work is waiting</h2>
            <ConceptInfo id="age" />
            <span className="ml-auto inline-flex items-center text-caption text-fg-3">
              Past due
              <ConceptInfo id="past_due" />
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {model.queue.map((row) => (
              <QueueRowView key={row.id} row={row} scale={model.scale} />
            ))}
          </div>
        </div>
        <div className="mt-2 text-caption text-fg-3">{done}</div>
      </section>

      <section className="mb-6 rounded-lg border border-line bg-panel">
        <div className="flex items-center gap-1 px-4 pt-4">
          <h2 className="text-section text-fg">Needs attention now</h2>
          <ConceptInfo id="slot_at_risk" />
        </div>
        <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            rows={attention}
            getKey={(row) => row.orderId}
            onRowClick={(row) => navigate(`/case/${row.orderId}`)}
            empty="Nothing at risk or past due."
          />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel">
        <h2 className="px-4 pt-4 text-section text-fg">By insurer</h2>
        <div className="overflow-x-auto">
          <DataTable
            comfortable
            columns={insurerColumns()}
            rows={model.byInsurer}
            getKey={(row) => row.insurer}
          />
        </div>
      </section>
    </main>
  );
}

function ScoreTileView({ tile }: { tile: ReturnType<typeof buildOperations>["tiles"][number] }) {
  const valueText = tile.value == null ? "—" : formatMetric(tile.metric, tile.value);
  const tone: StatusTone | null =
    tile.value != null && tile.metric.target != null
      ? trackTone(tile.metric.direction, tile.value, tile.metric.target)
      : null;
  const target = tile.metric.target == null ? tile.metric.targetDetail : formatMetric(tile.metric, tile.metric.target);
  return (
    <article
      className="flex h-full min-w-0 flex-col rounded-lg border border-line bg-panel p-3"
      aria-label={`${tile.metric.name}, ${valueText}${tone ? `, ${TRACK[tone]}` : ""}`}
    >
      <div className="flex items-start gap-1">
        <h2 className="min-w-0 flex-1 text-body font-semibold text-fg">{tile.metric.name}</h2>
        <MetricInfo metric={tile.metric} baseline={baselineFor(tile.metric)} />
      </div>
      <div className="mt-2 text-metric tabular text-fg">{valueText}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-caption text-fg-3">Target {target}</span>
        {tone && <StatusDot tone={tone} />}
      </div>
      <div className="mt-auto pt-3">
        <Sparkline values={tile.series} target={tile.metric.target} label={`${tile.metric.name}, eight weeks`} />
      </div>
    </article>
  );
}

function QueueRowView({ row, scale }: { row: QueueRowModel; scale: number }) {
  const parts = [
    { n: row.buckets[0], color: "var(--age-1)" },
    { n: row.buckets[1], color: "var(--age-2)" },
    { n: row.buckets[2], color: "var(--age-3)" },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1 lg:grid-cols-queue">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-body text-fg">{row.name}</span>
          <InfoButton label={`About ${row.name}`}>
            <div>
              <div className="text-fg-3">Definition</div>
              <div>{row.definition}</div>
            </div>
          </InfoButton>
        </div>
        <span className="tabular text-right text-body text-fg">{row.count}</span>
        <div
          className="col-span-2 flex h-2 overflow-hidden rounded-md bg-chip lg:col-span-1"
          title={`${row.buckets[0]} under 4 hours, ${row.buckets[1]} from 4 to 24, ${row.buckets[2]} over 24`}
        >
          {parts.map((part) =>
            part.n > 0 ? (
              <div key={part.color} style={{ width: `${(part.n / scale) * 100}%`, background: part.color }} />
            ) : null,
          )}
        </div>
        <div className="col-span-2 flex items-center justify-between gap-3 lg:contents">
          <span className="tabular text-body text-fg-2">{row.oldestHours == null ? "—" : fmtBusiness(row.oldestHours)}</span>
          {row.pastDue > 0 ? <span className="text-body text-bad">{row.pastDue} past due</span> : <span />}
        </div>
      </div>
      {row.reasons.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-caption text-fg-3">
          {row.reasons.map((reason, index) => (
            <span key={reason.label}>
              {index > 0 && <span className="mr-2">·</span>}
              <Link to={reasonHref(row.id, reason.label)} className="hover:text-fg">
                {reason.label} {reason.count}
              </Link>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function insurerColumns(): Column<ReturnType<typeof buildOperations>["byInsurer"][number]>[] {
  return [
    {
      id: "insurer",
      header: "Insurer",
      wrap: true,
      cell: (row) => {
        const above =
          row.aiReadyDenial != null && row.matchedBaseline != null && row.aiReadyDenial > row.matchedBaseline;
        return (
          <div className="min-w-0">
            <div className="text-fg">{row.insurer}</div>
            {above && (
              <Link
                to={`/?insurer=${encodeURIComponent(row.insurer)}`}
                className="mt-1 inline-flex items-center gap-1 text-caption text-fg-2"
              >
                <StatusDot tone="blocked" />
                Above baseline · autonomy held at {AUTONOMY_LABEL[row.autonomy]}
              </Link>
            )}
          </div>
        );
      },
    },
    {
      id: "autonomy",
      header: "Autonomy",
      cell: (row) => <Chip>{AUTONOMY_LABEL[row.autonomy]}</Chip>,
    },
    {
      id: "requests",
      header: "Requests",
      align: "right",
      cell: (row) => <span className="tabular">{row.requests}</span>,
    },
    {
      id: "touch",
      header: "No nurse touch",
      align: "right",
      cell: (row) => (
        <span className="tabular">{row.noNurse == null ? "—" : formatMetric(PERCENT, row.noNurse)}</span>
      ),
    },
    {
      id: "decision",
      header: "Decision time",
      align: "right",
      headerCell: (
        <span className="inline-flex items-center justify-end gap-1">
          Decision time
          <MetricInfo metric={OPS_METRICS.decision_time} baseline={OPS_METRICS.decision_time.baseline} />
        </span>
      ),
      cell: (row) => (
        <span className="tabular">{row.decisionHours == null ? "—" : formatMetric({ unit: "hours" }, row.decisionHours)}</span>
      ),
    },
    {
      id: "denials",
      header: "AI-ready denials",
      align: "right",
      headerCell: (
        <span className="inline-flex items-center justify-end gap-1">
          AI-ready denials
          <MetricInfo metric={METRICS.ai_ready_denial} baseline={baselineFor(METRICS.ai_ready_denial)} />
        </span>
      ),
      cell: (row) => {
        if (row.aiReadyDenial == null || row.matchedBaseline == null) return <span className="text-fg-3">—</span>;
        const worse = row.aiReadyDenial > row.matchedBaseline;
        return (
          <span className={cn("tabular", worse && "text-bad")}>
            {formatMetric(PERCENT, row.aiReadyDenial)} vs {formatMetric(PERCENT, row.matchedBaseline)}
          </span>
        );
      },
    },
    {
      id: "open",
      header: "Open",
      align: "right",
      cell: (row) => <span className="tabular">{row.open}</span>,
    },
  ];
}

const REASON_TAB: Record<QueueRowModel["id"], string> = {
  ai: "in_flight",
  coordinator: "admin",
  nurse: "clinical",
  insurer: "with_insurer",
};

function reasonHref(owner: QueueRowModel["id"], label: string): string {
  return `/?tab=${REASON_TAB[owner]}&reason=${encodeURIComponent(label)}`;
}

function baselineFor(metric: MetricSpec): number | null {
  if (metric === METRICS.spot_check || metric === METRICS.ai_ready_denial) {
    const full = metric as MetricDef;
    const reading = readMetric(full, WEEKS, "toDate", "all");
    return readingBaseline(full, WEEKS, reading, "all");
  }
  return metric.baseline;
}

function ScopeSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
  wide,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: string[];
  onChange: (value: string | null) => void;
  wide?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? "all"}
      onChange={(event) => onChange(event.target.value === "all" ? null : event.target.value)}
      className={cn(
        "h-7 rounded-md border border-line bg-panel px-2 text-body text-fg",
        wide ? "w-44" : "w-36",
      )}
    >
      <option value="all">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from "recharts";
import type { MetricDef } from "@/data/impact/metrics";
import { WEEK_MAX, WEEK_TICKS, type WeekRow } from "@/data/impact/weeks";
import type { ScopeId } from "@/domain/impact/compute";
import { scopedSample } from "@/domain/impact/compute";
import { fmtDelta, formatMetric, formatTick, unitLabel } from "@/domain/impact/format";
import { CHART_MARGIN, PhaseBands, tickStyle, X_DOMAIN, yScale } from "@/components/impact/chart-parts";

interface ChartPoint {
  week: number;
  value: number;
  valueText: string;
  solid: number | null;
  dashed: number | null;
  hollow: boolean;
  lastIndex: number;
  n: number;
  deltaText: string | null;
  wouldHave: number | null;
  wouldText: string | null;
  gap: [number, number] | null;
  band: [number, number] | null;
  bandText: string | null;
}

export function MetricChart({
  metric,
  rows,
  scope,
  baseline,
  target,
}: {
  metric: MetricDef;
  rows: WeekRow[];
  scope: ScopeId;
  baseline: number | null;
  target: number | null;
}) {
  const points = toPoints(metric, rows, scope, baseline);
  const headline = [...points].reverse().find((point) => !point.hollow) ?? points[points.length - 1];
  const firstHollow = points.find((point) => point.hollow);
  const showTarget = target != null && (baseline == null || Math.abs(target - baseline) > (metric.unit === "percent" ? 0.004 : 0.05));
  const domainValues = points.flatMap((point) => [point.value, point.wouldHave, point.band?.[0], point.band?.[1], baseline, target]);
  const scale = yScale(
    domainValues.filter((n): n is number => n != null),
    metric.unit,
  );
  const summary = `${metric.name}, ${headline?.valueText ?? ""}`;
  const hatchId = `incomplete-${metric.id}`;

  return (
    <div className="h-full w-full min-w-0">
      <ComposedChart
        responsive
        data={points}
        title={summary}
        margin={CHART_MARGIN}
        style={{ width: "100%", height: "100%", fontFamily: "var(--font-sans)" }}
      >
        <Customized component={() => <IncompleteHatch id={hatchId} />} />
        {firstHollow && (
          <ReferenceArea
            x1={firstHollow.week - 0.5}
            x2={WEEK_MAX + 0.5}
            fill={`url(#${hatchId})`}
            stroke="none"
            ifOverflow="hidden"
          />
        )}
        <PhaseBands />
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey="week"
          type="number"
          domain={X_DOMAIN}
          ticks={WEEK_TICKS}
          tickFormatter={(week) => `W${week}`}
          tick={tickStyle}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
        />
        <YAxis
          domain={scale.domain}
          ticks={scale.ticks}
          allowDataOverflow
          width={36}
          tickFormatter={(value) => formatTick(metric, Number(value))}
          tick={tickStyle}
          axisLine={false}
          tickLine={false}
          label={{
            value: unitLabel(metric),
            angle: -90,
            position: "insideLeft",
            offset: 12,
            style: { fill: "var(--fg-3)", fontSize: 12 },
          }}
        />
        <Tooltip
          content={MetricTip}
          cursor={{ stroke: "var(--line)" }}
          isAnimationActive={false}
          contentStyle={{ background: "transparent", border: "none", padding: 0, boxShadow: "none" }}
          wrapperStyle={{ outline: "none", zIndex: 20 }}
        />
        {points.some((point) => point.band) && (
          <Area
            dataKey="band"
            fill="var(--phase-shadow)"
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            dot={false}
            legendType="none"
          />
        )}
        {baseline != null && (
          <Area
            dataKey="gap"
            fill="var(--chart-fill)"
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            dot={false}
            legendType="none"
          />
        )}
        {baseline != null && <ReferenceLine y={baseline} stroke="var(--fg-3)" strokeDasharray="4 3" ifOverflow="hidden" />}
        {showTarget && target != null && (
          <ReferenceLine y={target} stroke="var(--fg-3)" strokeDasharray="1.5 3" ifOverflow="hidden" />
        )}
        {metric.counterfactual && (
          <Line
            dataKey="wouldHave"
            stroke="var(--chart-faint)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls
          />
        )}
        <Line
          dataKey="solid"
          stroke="var(--accent)"
          strokeWidth={1.5}
          dot={solidDot}
          activeDot={false}
          isAnimationActive={false}
          legendType="none"
          connectNulls={false}
        />
        {points.some((point) => point.hollow) && (
          <Line
            dataKey="dashed"
            stroke="var(--accent)"
            strokeDasharray="1 3"
            strokeWidth={1.5}
            dot={hollowDot}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
          />
        )}
        {baseline != null && <RuleLabel y={baseline} text={`Baseline ${formatMetric(metric, baseline)}`} align="start" />}
        {showTarget && target != null && <RuleLabel y={target} text={`Target ${formatMetric(metric, target)}`} align="start" />}
        <EndLabels
          point={headline}
          tail={firstHollow ? points[points.length - 1] : undefined}
          callout={widestGap(points)}
          metricLabel={metric.counterfactual?.label ?? null}
          bandPoint={points[points.length - 1]}
          bandLabel={metric.band?.label ?? null}
        />
      </ComposedChart>
      <table className="sr-only">
        <caption>{metric.name} by week</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Value</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.week}>
              <td>
                W{point.week}
                {point.hollow ? " incomplete" : ""}
              </td>
              <td>{point.valueText}</td>
              <td>{point.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toPoints(metric: MetricDef, rows: WeekRow[], scope: ScopeId, baseline: number | null): ChartPoint[] {
  const lastComplete = rows.reduce((acc, row, index) => (metric.lag != null && row.incomplete[metric.lag] ? acc : index), -1);
  const allMissing = lastComplete < 0;
  const hasTail = lastComplete >= 0 && lastComplete < rows.length - 1;
  return rows.map((row, index) => {
    const hollow = metric.lag != null && row.incomplete[metric.lag];
    const value = row[metric.series];
    const would = metric.counterfactual ? row[metric.counterfactual.key] : null;
    const low = metric.band ? row[metric.band.low] : null;
    const high = metric.band ? row[metric.band.high] : null;
    return {
      week: row.week,
      value,
      valueText: formatMetric(metric, value),
      solid: allMissing ? null : index <= lastComplete ? value : null,
      dashed: allMissing ? value : hasTail && index >= lastComplete ? value : null,
      hollow,
      lastIndex: rows.length - 1,
      n: scopedSample(row, metric.series, scope),
      deltaText: baseline == null ? null : fmtDelta(metric, value, baseline),
      wouldHave: would,
      wouldText: would == null ? null : formatMetric(metric, would),
      gap: baseline == null ? null : [baseline, value],
      band: low == null || high == null ? null : [low, high],
      bandText: low == null || high == null ? null : `${formatMetric(metric, low)}–${formatMetric(metric, high)}`,
    };
  });
}

interface DotRender {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartPoint;
}

function solidDot(props: DotRender) {
  return <PointDot {...props} variant="solid" />;
}

function hollowDot(props: DotRender) {
  return <PointDot {...props} variant="hollow" />;
}

function PointDot({ cx, cy, index, payload, variant }: DotRender & { variant: "solid" | "hollow" }) {
  if (cx == null || cy == null || index == null || !payload) return <g />;
  if (variant === "solid" && (payload.solid == null || payload.hollow)) return <g />;
  if (variant === "hollow" && !payload.hollow) return <g />;
  const last = index === payload.lastIndex;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={last ? 4 : 2.5}
      fill={payload.hollow ? "var(--panel)" : "var(--accent)"}
      stroke="var(--accent)"
      strokeWidth={1.5}
    />
  );
}

function RuleLabel({ y, text, align }: { y: number; text: string; align: "start" | "end" }) {
  const plot = usePlotArea();
  const yScale = useYAxisScale();
  if (!plot || !yScale) return null;
  const yPix = yScale(y);
  if (yPix == null) return null;
  const x = align === "start" ? plot.x + 2 : plot.x + plot.width - 2;
  const above = Math.max(plot.y + 12, yPix - 12);
  return (
    <text x={x} y={above} textAnchor={align} fill="var(--fg-3)" fontSize={12}>
      {text}
    </text>
  );
}

function widestGap(points: ChartPoint[]): ChartPoint | null {
  let best: ChartPoint | null = null;
  let gap = -1;
  for (const point of points) {
    if (point.wouldHave == null) continue;
    const next = Math.abs(point.wouldHave - point.value);
    if (next > gap) {
      gap = next;
      best = point;
    }
  }
  return best;
}

function IncompleteHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--fg-3)" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

function EndLabels({
  point,
  tail,
  callout,
  metricLabel,
  bandPoint,
  bandLabel,
}: {
  point: ChartPoint | undefined;
  tail?: ChartPoint;
  callout: ChartPoint | null;
  metricLabel: string | null;
  bandPoint: ChartPoint | undefined;
  bandLabel: string | null;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!point || !xScale || !yScale) return null;
  const x = xScale(point.week);
  const y = yScale(point.value);
  if (x == null || y == null) return null;
  const callX = callout ? xScale(callout.week) : null;
  const callY = callout?.wouldHave == null ? null : yScale(callout.wouldHave);
  const band = bandPoint?.band;
  const bandX = bandPoint ? xScale(bandPoint.week) : null;
  const bandMid = band == null ? null : yScale((band[0] + band[1]) / 2);
  const tailX = tail ? xScale(tail.week) : null;
  const tailY = tail ? yScale(tail.value) : null;
  return (
    <g>
      <text x={x + 8} y={y} fill="var(--fg)" fontSize={12} dominantBaseline="central">
        {point.valueText}
      </text>
      {tail && tailX != null && tailY != null && (
        <text x={tailX + 8} y={tailY - 12} fill="var(--fg-3)" fontSize={12}>
          Incomplete
        </text>
      )}
      {metricLabel && callX != null && callY != null && (
        <text x={callX + 8} y={callY - 10} fill="var(--fg-2)" fontSize={12}>
          {metricLabel}
        </text>
      )}
      {bandLabel && bandX != null && bandMid != null && (
        <text x={bandX - 8} y={bandMid} textAnchor="end" fill="var(--fg-3)" fontSize={12} dominantBaseline="central">
          {bandLabel}
        </text>
      )}
    </g>
  );
}

function MetricTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-line bg-panel px-2 py-1 text-caption text-fg shadow-sm">
      <div>W{point.week}</div>
      <div className="tabular">{point.valueText}</div>
      <div className="tabular text-fg-2">n {point.n.toLocaleString("en-US")}</div>
      {point.deltaText && <div className="tabular text-fg-2">{point.deltaText} vs baseline</div>}
      {point.wouldText && <div className="text-fg-2">Would have {point.wouldText}</div>}
      {point.bandText && <div className="text-fg-2">Matched {point.bandText}</div>}
      {point.hollow && <div className="text-fg-3">Incomplete</div>}
    </div>
  );
}

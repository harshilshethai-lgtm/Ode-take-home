import { Area, CartesianGrid, ComposedChart, Tooltip, XAxis, YAxis, useXAxisScale, useYAxisScale } from "recharts";
import type { SeriesKey } from "@/data/impact/metrics";
import { WEEK_MAX, WEEK_TICKS } from "@/data/impact/weeks";
import type { CumulativePoint } from "@/domain/impact/compute";
import { fmtMoney, fmtMoneyTick } from "@/domain/impact/format";
import { CHART_MARGIN, moneyScale, PhaseBands, tickStyle, X_DOMAIN } from "@/components/impact/chart-parts";

const LEVER_FILL = ["var(--lever-1)", "var(--lever-2)", "var(--lever-3)", "var(--lever-4)", "var(--lever-5)"];

export function ValueChart({
  series,
  stack,
}: {
  series: CumulativePoint[];
  stack: { id: SeriesKey; name: string }[];
}) {
  const last = series[series.length - 1];
  const peak = series.reduce((max, point) => Math.max(max, totalOf(point, stack)), 0);
  const scale = moneyScale(peak);

  return (
    <div className="h-full w-full min-w-0">
      <ComposedChart
        responsive
        data={series}
        margin={{ ...CHART_MARGIN, right: 8 }}
        style={{ width: "100%", height: "100%", fontFamily: "var(--font-sans)" }}
      >
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
          width={48}
          tickFormatter={(value) => fmtMoneyTick(Number(value))}
          tick={tickStyle}
          axisLine={false}
          tickLine={false}
          label={{
            value: "$",
            position: "insideTopLeft",
            offset: 0,
            style: { fill: "var(--fg-3)", fontSize: 12 },
          }}
        />
        <Tooltip
          content={(props) => <ValueTip {...props} stack={stack} />}
          cursor={{ stroke: "var(--line)" }}
          isAnimationActive={false}
          contentStyle={{ background: "transparent", border: "none", padding: 0, boxShadow: "none" }}
          wrapperStyle={{ outline: "none", zIndex: 20 }}
        />
        {stack.map((lever, index) => (
          <Area
            key={lever.id}
            dataKey={lever.id}
            stackId="value"
            fill={LEVER_FILL[index] ?? LEVER_FILL[LEVER_FILL.length - 1]}
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            dot={false}
            legendType="none"
          />
        ))}
        <StackLabels stack={stack} last={last} />
      </ComposedChart>
    </div>
  );
}

function totalOf(point: CumulativePoint | undefined, stack: { id: SeriesKey }[]): number {
  if (!point) return 0;
  return stack.reduce((sum, lever) => sum + (point[lever.id] ?? 0), 0);
}

function StackLabels({ stack, last }: { stack: { id: SeriesKey; name: string }[]; last: CumulativePoint | undefined }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale || !last) return null;
  const x = xScale(WEEK_MAX);
  if (x == null) return null;
  let acc = 0;
  const placed: { name: string; y: number }[] = [];
  for (const lever of stack) {
    const value = last[lever.id] ?? 0;
    const mid = acc + value / 2;
    acc += value;
    if (value <= 0) continue;
    const y = yScale(mid);
    if (y == null) continue;
    placed.push({ name: lever.name, y });
  }
  placed.sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].y - placed[i - 1].y < 14) placed[i].y = placed[i - 1].y + 14;
  }
  return (
    <g>
      {placed.map((label) => (
        <text
          key={label.name}
          x={x - 6}
          y={label.y}
          textAnchor="end"
          fill="var(--fg)"
          fontSize={12}
          dominantBaseline="central"
        >
          {label.name}
        </text>
      ))}
    </g>
  );
}

function ValueTip({
  active,
  payload,
  stack,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CumulativePoint }>;
  stack: { id: SeriesKey; name: string }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const total = totalOf(point, stack);
  return (
    <div className="rounded-md border border-line bg-panel px-2 py-1 text-caption text-fg shadow-sm">
      <div>W{point.week}</div>
      {stack.map((lever) => (
        <div key={lever.id} className="tabular text-fg-2">
          {lever.name} {fmtMoney(point[lever.id] ?? 0)}
        </div>
      ))}
      <div className="tabular">Total {fmtMoney(total)}</div>
    </div>
  );
}

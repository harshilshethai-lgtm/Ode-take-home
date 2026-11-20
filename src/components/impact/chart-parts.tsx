import { ReferenceArea, usePlotArea, useXAxisScale } from "recharts";
import { PHASES, WEEK_MAX, WEEK_MIN, type Phase } from "@/data/impact/weeks";

const PHASE_FILL: Record<Phase, string> = {
  shadowWeeks: "var(--phase-shadow)",
  assisted: "var(--phase-assisted)",
  expand: "var(--phase-expand)",
};

export const CHART_MARGIN = { top: 18, right: 64, bottom: 4, left: 0 };

export const tickStyle = { fill: "var(--fg-3)", fontSize: 12 };

/** Faint vertical bands. Labels sit in the top margin, shared by every chart. */
export function PhaseBands() {
  return (
    <>
      {PHASES.map((phase) => (
        <ReferenceArea
          key={phase.id}
          x1={phase.from - 0.5}
          x2={phase.to + 0.5}
          fill={PHASE_FILL[phase.id]}
          fillOpacity={1}
          stroke="none"
          ifOverflow="hidden"
        />
      ))}
      <PhaseLabels />
    </>
  );
}

function PhaseLabels() {
  const xScale = useXAxisScale();
  const plot = usePlotArea();
  if (!xScale || !plot) return null;
  return (
    <g>
      {PHASES.map((phase) => {
        const left = xScale(phase.from - 0.5);
        const right = xScale(phase.to + 0.5);
        if (left == null || right == null) return null;
        return (
          <text
            key={phase.id}
            x={(left + right) / 2}
            y={Math.max(12, plot.y - 5)}
            textAnchor="middle"
            fill="var(--fg-3)"
            fontSize={12}
          >
            {phase.label}
          </text>
        );
      })}
    </g>
  );
}

export const X_DOMAIN: [number, number] = [WEEK_MIN - 0.5, WEEK_MAX + 0.5];

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const err = rough / pow;
  const nice = err <= 1 ? 1 : err <= 2 ? 2 : err <= 2.5 ? 2.5 : err <= 5 ? 5 : 10;
  return nice * pow;
}

/** 3–4 ticks across the data, with a little headroom above the last tick for labels. */
export function yScale(values: number[], unit: "percent" | "minutes" | "hours"): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return { domain: [0, 1], ticks: [0, 0.5, 1] };
  let lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (unit === "percent" && hi - lo >= 0.4) lo = 0;
  lo = Math.max(0, lo);
  const span = Math.max(hi - lo, unit === "percent" ? 0.04 : 1);
  const step = niceStep(span / 3);
  const start = Math.max(0, Math.floor(lo / step + 1e-9) * step);
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-6 && ticks.length < 4; v += step) {
    const rounded = Number(v.toFixed(4));
    if (unit === "percent" && rounded > 1) break;
    ticks.push(rounded);
  }
  if (lo === 0 && ticks[0] !== 0) ticks.unshift(0);
  const lastTick = ticks[ticks.length - 1];
  if (lastTick != null && lastTick < hi - step * 0.15 && ticks.length < 4) {
    const next = Number((lastTick + step).toFixed(4));
    if (!(unit === "percent" && next > 1)) ticks.push(next);
  }
  const shown = ticks.slice(0, 4);
  const last = shown[shown.length - 1] ?? hi;
  const floor = Math.min(lo, shown[0] ?? lo);
  const domainLo = floor <= 0 ? 0 : Math.max(0, floor - span * 0.08);
  return { domain: [domainLo, Math.max(hi, last) + span * 0.2], ticks: shown };
}

export function moneyScale(peak: number): { domain: [number, number]; ticks: number[] } {
  const hi = Math.max(peak, 1);
  const step = niceStep(hi / 3);
  const ticks: number[] = [];
  for (let v = 0; v <= hi * 1.001 && ticks.length < 4; v += step) ticks.push(v);
  const last = ticks[ticks.length - 1] ?? 0;
  return { domain: [0, Math.max(hi * 1.18, last + step * 0.35)], ticks };
}

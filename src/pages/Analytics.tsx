import { useMemo } from "react";
import { SEED_ORDERS } from "@/data/orders";
import { GROUP_LABEL, STATUSES, type StatusGroup } from "@/domain/statuses";
import { matchesQuick, toRow } from "@/lib/worklist";

// From PRD §Success metrics. "Today" and targets are proposals to agree with Halcyon during discovery.
const SUCCESS_METRICS: { metric: string; today: string; target: string }[] = [
  { metric: "Share of requests submitted without a nurse touch", today: "0%", target: "50% or more of routine MRI/CT" },
  { metric: "Order received to submitted (median)", today: "~1 to 2 days", target: "Same day for auto-submit" },
  {
    metric: "Missing documentation found at intake vs. at nurse review",
    today: "Found at nurse review",
    target: "90% or more found at intake",
  },
  { metric: "Denials for incomplete documentation", today: "Part of 11%", target: "Down 50%" },
  { metric: "Scans cancelled for lack of approval", today: "Not measured", target: "Measured, then down 50%" },
  { metric: "Auto-submits a nurse audit later overturns", today: "n/a", target: "Under 1%" },
];

const GROUP_BAR: Record<StatusGroup, string> = {
  automated: "bg-slate-400",
  coordinator: "bg-amber-400",
  nurse: "bg-violet-500",
  insurer: "bg-sky-500",
  closed: "bg-emerald-500",
};

export default function Analytics() {
  const rows = useMemo(() => SEED_ORDERS.map((o) => toRow(o)), []);
  const open = rows.filter((r) => !r.closed);

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.order.status, (counts.get(r.order.status) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, n]) => ({ def: STATUSES[id as keyof typeof STATUSES], n }))
      .sort((a, b) => b.n - a.n);
  }, [rows]);

  const max = Math.max(1, ...byStatus.map((s) => s.n));
  const noTouch = rows.filter((r) => matchesQuick(r, "no_touch")).length;
  const needsPerson = rows.filter((r) => matchesQuick(r, "needs_person")).length;
  const slotAtRisk = rows.filter((r) => matchesQuick(r, "slot_at_risk")).length;
  const overSla = open.filter((r) => r.overSla).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-slate-500">Throughput, time to submission, denial and cancellation rates.</p>
      </div>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">Right now</h2>
        <p className="mb-3 text-xs text-slate-500">
          Computed live from the {rows.length} orders on the worklist (sample data, not production volume).
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Open orders" value={open.length} />
          <Stat label="Needs a person" value={needsPerson} />
          <Stat label="Ready, no touch" value={noTouch} tone="good" />
          <Stat label="Slot at risk" value={slotAtRisk} tone={slotAtRisk > 0 ? "bad" : undefined} />
          <Stat label="Over status SLA" value={overSla} tone={overSla > 0 ? "warn" : undefined} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Orders by status</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <ul className="space-y-2.5">
            {byStatus.map(({ def, n }) => (
              <li key={def.id} className="grid grid-cols-[170px_1fr_28px] items-center gap-3 text-sm">
                <div className="truncate text-slate-700">
                  {def.label} <span className="text-xs text-slate-400">· {GROUP_LABEL[def.group]}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className={`h-2.5 rounded-full ${GROUP_BAR[def.group]}`} style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <div className="tabular text-right font-medium text-slate-800">{n}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">v1 success metrics</h2>
        <p className="mb-3 text-xs text-slate-500">
          Targets from the PRD, proposed to agree with Halcyon during discovery. Live values need real order volume.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Metric</th>
                <th className="w-48 px-4 py-2.5 font-medium">Today</th>
                <th className="w-64 px-4 py-2.5 font-medium">v1 target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SUCCESS_METRICS.map((m) => (
                <tr key={m.metric}>
                  <td className="px-4 py-2.5 text-slate-800">{m.metric}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.today}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{m.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color =
    tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`tabular text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

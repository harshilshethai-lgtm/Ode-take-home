import { useMemo } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageTitle } from "@/components/ui/page-title";
import { PropertyList } from "@/components/ui/property-list";
import { StatusLabel } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import { SEED_ORDERS } from "@/data/orders";
import { STATUSES, type StatusId } from "@/domain/statuses";
import { statusTone } from "@/lib/statusTone";
import { matchesQuick, toRow } from "@/lib/worklist";

// From PRD §Success metrics. "Today" and targets are proposals to agree with Halcyon during discovery.
const SUCCESS_METRICS: { metric: string; today: string; target: string }[] = [
  { metric: "Submitted without a nurse touch", today: "0%", target: "≥ 50% of routine MRI/CT" },
  { metric: "Order to submitted (median)", today: "1 to 2 days", target: "Same day" },
  { metric: "Missing docs found at intake", today: "At nurse review", target: "≥ 90%" },
  { metric: "Denials for incomplete docs", today: "Part of 11%", target: "Down 50%" },
  { metric: "Scans cancelled, no approval", today: "Not measured", target: "Down 50%" },
  { metric: "Auto-submits overturned", today: "n/a", target: "< 1%" },
];

const metricColumns: Column<(typeof SUCCESS_METRICS)[number]>[] = [
  { id: "metric", header: "Metric", cell: (m) => <span className="text-fg">{m.metric}</span> },
  { id: "today", header: "Today", cell: (m) => <span className="text-fg-2">{m.today}</span> },
  { id: "target", header: "Target", cell: (m) => m.target },
];

export default function Analytics() {
  const rows = useMemo(() => SEED_ORDERS.map((o) => toRow(o)), []);
  const open = rows.filter((r) => !r.closed);

  const byStatus = useMemo(() => {
    const counts = new Map<StatusId, number>();
    for (const r of rows) counts.set(r.order.status, (counts.get(r.order.status) ?? 0) + 1);
    return [...counts.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n);
  }, [rows]);
  const max = Math.max(1, ...byStatus.map((s) => s.n));

  return (
    <main className="mx-auto w-full max-w-page p-6">
      <div className="mb-6">
        <PageTitle>Analytics</PageTitle>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-section text-fg">Right now</h2>
        <div className="rounded-lg border border-line bg-panel p-4">
          <PropertyList
            items={[
              { label: "Open orders", value: open.length },
              { label: "Needs a person", value: rows.filter((r) => matchesQuick(r, "needs_person")).length },
              { label: "Ready, no touch", value: rows.filter((r) => matchesQuick(r, "no_touch")).length },
              { label: "Slot at risk", value: rows.filter((r) => matchesQuick(r, "slot_at_risk")).length },
              { label: "Over SLA", value: open.filter((r) => r.overSla).length },
            ]}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-section text-fg">By status</h2>
        <div className="rounded-lg border border-line bg-panel p-4">
          <ul className="space-y-2">
            {byStatus.map(({ id, n }) => (
              <li key={id} className="grid h-5 grid-cols-rule items-center gap-4">
                <span className="tabular text-right text-fg">{n}</span>
                <Tip content={STATUSES[id].meaning}>
                  <span>
                    <StatusLabel tone={statusTone(id)}>{STATUSES[id].label}</StatusLabel>
                  </span>
                </Tip>
                <span className="h-1 w-40 rounded-md bg-chip">
                  <span className="block h-1 rounded-md bg-fg-3" style={{ width: `${(n / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-section text-fg">Targets</h2>
        <div className="rounded-lg border border-line bg-panel">
          <DataTable columns={metricColumns} rows={SUCCESS_METRICS} getKey={(m) => m.metric} />
        </div>
      </section>
    </main>
  );
}

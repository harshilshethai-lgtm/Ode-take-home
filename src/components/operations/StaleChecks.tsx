import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { affectedList } from "@/lib/evalNotice";
import { staleCases } from "@/lib/staleCases";
import { useRulesActor } from "@/lib/rulesActor";
import { useRules } from "@/lib/useRules";
import { useOrders } from "@/lib/useWorklistState";

/** Unsubmitted cases that were checked against a rule version that no longer applies, with a bulk re-check. */
export function StaleChecks() {
  const api = useRules();
  const actor = useRulesActor();
  const { orders } = useOrders();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<number | null>(null);

  const rows = staleCases(orders, api);
  const chosen = rows.filter((r) => selected.has(r.evaluation.id));
  const allSelected = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const recheck = () => {
    const made = api.recheckEvaluations(chosen.map((r) => r.evaluation.id), actor.name);
    setSelected(new Set());
    setDone(made.length);
  };

  return (
    <section aria-label="Needs re-check" className="mb-6">
      <div className="mb-2 flex min-h-8 items-center gap-2">
        <h2 className="text-section text-fg">Needs re-check</h2>
        {rows.length > 0 && <span className="text-caption text-fg-2">{rows.length}</span>}
        {rows.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-caption text-fg-2">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.evaluation.id)))}
              className="accent-accent"
            />
            Select all
          </label>
        )}
        {rows.length > 0 && (
          <Button variant="default" disabled={chosen.length === 0} onClick={recheck}>
            {chosen.length > 0 ? `Re-check ${chosen.length}` : "Re-check"}
          </Button>
        )}
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-body text-fg-2">
            {done ? `Re-checked ${done} ${done === 1 ? "case" : "cases"}.` : "Every unsubmitted case was checked against the rules that apply."}
          </div>
        ) : (
          <ul>
            {rows.map(({ order, evaluation, staleness }) => (
              <li key={evaluation.id} data-row className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  type="checkbox"
                  aria-label={`Select ${order.patient?.name ?? order.orderNumber}`}
                  checked={selected.has(evaluation.id)}
                  onChange={() => toggle(evaluation.id)}
                  className="accent-accent"
                />
                <div className="min-w-48 flex-1">
                  <Link to={`/case/${order.id}`} className="block truncate text-body text-accent-fg hover:underline">
                    {order.patient?.name ?? order.orderNumber} · {order.orderNumber}
                  </Link>
                  <div className="truncate text-caption text-fg-2">
                    {evaluation.rulesSnapshot?.payerName} {evaluation.rulesSnapshot?.externalPolicyId} v{staleness.pinned.versionNumber} → v
                    {staleness.applicable.versionNumber} ·{" "}
                    {staleness.affected.length > 0 ? affectedList(staleness.affected) : "No criteria affected"}
                  </div>
                </div>
                <StatusPill status={order.status} channel={order.channel} confirmOnly={order.confirmOnly} linked={order.linkedApproval} />
                <Link to={`/evaluations/${evaluation.id}`} className="shrink-0 text-caption text-accent-fg hover:underline">
                  View check
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

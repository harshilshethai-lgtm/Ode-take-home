import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DiffView } from "@/components/rules/DiffView";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { inputCls } from "@/components/rules/fields";
import { Banner, Card, EmptyState, VersionStatusBadge } from "@/components/rules/ui";
import { effectiveRange } from "@/lib/rulesFormat";
import { useRules } from "@/lib/useRules";

export default function Compare() {
  const { policyId = "" } = useParams();
  const api = useRules();
  const [params, setParams] = useSearchParams();
  const [showUnchanged, setShowUnchanged] = useState(false);

  let detail: ReturnType<typeof api.getPolicy>;
  try {
    detail = api.getPolicy(policyId);
  } catch {
    return <main className="px-6 py-6"><EmptyState>That policy does not exist.</EmptyState></main>;
  }
  const { policy, payer, versions } = detail;
  const asc = [...versions].sort((x, y) => x.versionNumber - y.versionNumber);
  const byId = (id: string | null) => asc.find((v) => v.id === id);
  // Defaults: previous version vs the one named in ?b= (or the newest).
  const b = byId(params.get("b")) ?? asc[asc.length - 1];
  const a = byId(params.get("a")) ?? [...asc].reverse().find((v) => v.versionNumber < (b?.versionNumber ?? 0)) ?? asc[0];
  const set = (k: "a" | "b", v: string) => setParams({ a: a?.id ?? "", b: b?.id ?? "", [k]: v });

  const diff = a && b && a.id !== b.id ? api.compareVersions(a.id, b.id) : null;
  const label = (v: (typeof asc)[number]) => `v${v.versionNumber} · ${v.derivedStatus}${v.effectiveFrom ? ` · from ${v.effectiveFrom}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: `${payer.name} ${policy.externalPolicyId}`, to: `/settings/rules/${policyId}` }, { label: "Compare" }]} />
      <h1 className="mb-1 text-xl font-semibold">Compare versions</h1>
      <p className="mb-4 text-sm text-slate-500">Criteria are matched by their stable key, so a reworded or renumbered rule shows as changed, not as removed and added.</p>

      <Card className="mb-5">
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const v = side === "a" ? a : b;
            return (
              <label key={side} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{side === "a" ? "From (before)" : "To (after)"}</span>
                <select value={v?.id ?? ""} onChange={(e) => set(side, e.target.value)} className={inputCls}>
                  {asc.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
                </select>
                {v && (
                  <span className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                    <VersionStatusBadge status={v.derivedStatus} /> {effectiveRange(v)}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Card>

      {!diff ? (
        <Banner tone="sky">Choose two different versions to compare.</Banner>
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-semibold">v{diff.a.versionNumber} → v{diff.b.versionNumber}</h2>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
              Show unchanged criteria
            </label>
          </div>
          <div className="px-5 py-4">
            <DiffView diff={diff} showUnchanged={showUnchanged} />
          </div>
        </Card>
      )}
      <p className="mt-4 text-sm"><Link to={`/settings/rules/${policyId}`} className="text-indigo-700 hover:underline">Back to {policy.externalPolicyId}</Link></p>
    </main>
  );
}

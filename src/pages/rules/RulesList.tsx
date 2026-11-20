import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Search } from "lucide-react";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { Banner, Card, Pill, VersionStatusBadge } from "@/components/rules/ui";
import { inputCls } from "@/components/rules/fields";
import { humanize } from "@/domain/rules/common";
import { useRules } from "@/lib/useRules";
import { useRulesUser } from "@/lib/rulesUser";
import { fmtDateTime } from "@/lib/rulesFormat";
import CoverageGaps from "./CoverageGaps";

export default function RulesList() {
  const api = useRules();
  const { user } = useRulesUser();
  const [payerId, setPayerId] = useState("");
  const [bodySite, setBodySite] = useState("");
  const [cpt, setCpt] = useState("");
  const [onlyAssumptions, setOnlyAssumptions] = useState(false);
  const [q, setQ] = useState("");

  const all = api.listPolicies();
  const payers = useMemo(() => [...new Map(all.map((s) => [s.payer.id, s.payer])).values()], [all]);
  const sites = useMemo(() => [...new Set(all.map((s) => s.policy.bodySite))], [all]);

  const cptQuery = cpt.trim() || (/^\d{4}[0-9A-Z]$/.test(q.trim()) ? q.trim() : "");
  const rows = api.listPolicies({ payerId: payerId || undefined, bodySite: bodySite || undefined, cpt: cpt.trim() || undefined, hasAssumptions: onlyAssumptions, q });
  const governing = cptQuery.length === 5 ? api.findPolicyForCpt(cptQuery) : [];

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 py-6">
      <RulesHeader crumbs={[{ label: "Prior-auth rules" }]} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Prior-auth rules</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Each insurer policy, in the insurer's own words. Edits happen in drafts, are tested and diffed, then published as a new version with an effective date. Published versions never change.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600" title="When on, the publisher must be an approver and someone other than the last editor.">
          <input type="checkbox" checked={api.getConfig().twoPersonRule} onChange={(e) => api.setTwoPersonRule(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
          Two-person rule for publishing
        </label>
      </div>

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <label className="min-w-[14rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
            <span className="relative block">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Policy ID, title, payer or CPT code" className={`${inputCls} pl-8`} />
            </span>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Payer</span>
            <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className={inputCls}>
              <option value="">All payers</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Body site</span>
            <select value={bodySite} onChange={(e) => setBodySite(e.target.value)} className={inputCls}>
              <option value="">All</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">CPT</span>
            <input value={cpt} onChange={(e) => setCpt(e.target.value)} placeholder="e.g. 72148" className={`${inputCls} w-28`} />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyAssumptions} onChange={(e) => setOnlyAssumptions(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            Has assumptions
          </label>
        </div>

        {cptQuery.length === 5 && (
          <div className="border-b border-slate-100 px-4 py-3">
            {governing.length === 0 ? (
              <Banner tone="amber">No policy covers CPT {cptQuery}. If this code requires prior auth, it is a coverage gap.</Banner>
            ) : (
              <Banner tone="sky">
                {governing.map((g) => (
                  <div key={g.policy.id}>
                    CPT {cptQuery} is {g.status === "governs" ? "governed by" : g.status === "scheduled" ? "covered from a scheduled version of" : "only in a draft of"}{" "}
                    <Link className="font-medium underline" to={`/settings/rules/${g.policy.id}${g.version ? `/versions/${g.version.id}` : ""}`}>
                      {g.payer.name} {g.policy.externalPolicyId}
                    </Link>
                    {g.version && ` (v${g.version.versionNumber}${g.version.effectiveFrom ? `, effective ${g.version.effectiveFrom}` : ""})`}.
                  </div>
                ))}
              </Banner>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                {["Payer", "Policy ID", "Title", "CPT codes", "Active version", "Pending", "⚠", "Last updated"].map((h) => (
                  <th key={h} className="px-4 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.policy.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">{s.payer.name}</td>
                  <td className="px-4 py-3">
                    <Link to={`/settings/rules/${s.policy.id}`} className="font-medium text-indigo-700 hover:underline">
                      {s.policy.externalPolicyId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{s.policy.title}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.cptCodes.join(", ")}</td>
                  <td className="px-4 py-3">
                    {s.current ? (
                      <span className="flex items-center gap-2">
                        <Link to={`/settings/rules/${s.policy.id}/versions/${s.current.id}`} className="hover:underline">
                          v{s.current.versionNumber}
                        </Link>
                        <VersionStatusBadge status={s.current.derivedStatus} />
                        <span className="text-xs text-slate-500">from {s.current.effectiveFrom}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1.5">
                      {s.openDraft && (
                        <Link to={`/settings/rules/${s.policy.id}/versions/${s.openDraft.id}/edit`}>
                          <Pill tone="amber">Draft v{s.openDraft.versionNumber}</Pill>
                        </Link>
                      )}
                      {s.scheduled && s.scheduled.id !== s.current?.id && (
                        <Link to={`/settings/rules/${s.policy.id}/versions/${s.scheduled.id}`}>
                          <Pill tone="sky">v{s.scheduled.versionNumber} from {s.scheduled.effectiveFrom}</Pill>
                        </Link>
                      )}
                      {!s.openDraft && !s.scheduled && <span className="text-slate-400">–</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.warningCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700" title={s.hasAssumptions ? "Includes assumptions to confirm with the payer" : "Validation warnings"}>
                        <AlertTriangle size={14} /> {s.warningCount}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.lastUpdatedBy}
                    <div className="text-slate-400">{fmtDateTime(s.lastUpdatedAt)}</div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    No policies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CoverageGaps />
      <p className="mt-4 text-xs text-slate-400">Signed in as {user.name} ({user.role}).</p>
    </main>
  );
}

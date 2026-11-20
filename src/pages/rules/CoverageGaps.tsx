import { Link } from "react-router-dom";
import { AlertTriangle, FileWarning, FlaskConical, ListX } from "lucide-react";
import { Button, Card, Pill } from "@/components/rules/ui";
import { SEED_PDF_HASH } from "@/data/rules/seed";
import { useRules } from "@/lib/useRules";

/** Where the rule library is thin: uncovered CPTs, untested policies, open assumptions, drifted source documents. */
export default function CoverageGaps() {
  const api = useRules();
  const gaps = api.getCoverageGaps();
  const total = gaps.cptWithoutCriteria.length + gaps.policiesWithoutTests.length + gaps.assumptionVersions.length + gaps.sourceChanged.length;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={15} className="text-amber-600" /> Coverage gaps
            <Pill tone={total ? "amber" : "emerald"}>{total ? `${total} to look at` : "None"}</Pill>
          </h2>
          <p className="text-xs text-slate-500">Places where the rule library cannot yet be fully trusted.</p>
        </div>
      </div>
      <div className="grid gap-px bg-slate-100 md:grid-cols-2">
        <Panel icon={<ListX size={14} />} title="CPT codes that need prior auth but have no criteria" empty="Every prior-auth CPT is covered." count={gaps.cptWithoutCriteria.length}>
          {gaps.cptWithoutCriteria.map((c) => (
            <li key={`${c.payerId}-${c.cptCode}`}>
              <span className="font-mono text-xs">{c.cptCode}</span> · {c.payerName} <span className="text-slate-500">· {c.description}</span>
            </li>
          ))}
        </Panel>
        <Panel icon={<FlaskConical size={14} />} title="Policies without test cases" empty="Every policy has test cases." count={gaps.policiesWithoutTests.length}>
          {gaps.policiesWithoutTests.map(({ policy, payer }) => (
            <li key={policy.id}>
              <Link className="text-indigo-700 hover:underline" to={`/settings/rules/${policy.id}`}>
                {payer.name} {policy.externalPolicyId}
              </Link>
            </li>
          ))}
        </Panel>
        <Panel icon={<AlertTriangle size={14} />} title="Versions with assumptions" empty="No open assumptions." count={gaps.assumptionVersions.length}>
          {gaps.assumptionVersions.map(({ policy, payer, version, count }) => (
            <li key={version.id}>
              <Link className="text-indigo-700 hover:underline" to={`/settings/rules/${policy.id}/versions/${version.id}`}>
                {payer.name} {policy.externalPolicyId} v{version.versionNumber}
              </Link>{" "}
              <span className="text-slate-500">· {count} assumption{count === 1 ? "" : "s"} to confirm with the payer</span>
            </li>
          ))}
        </Panel>
        <Panel icon={<FileWarning size={14} />} title="Source document changed since publish" empty="Source documents match what was published." count={gaps.sourceChanged.length}>
          {gaps.sourceChanged.map(({ policy, payer, version, document }) => (
            <li key={version.id}>
              <Link className="text-indigo-700 hover:underline" to={`/settings/rules/${policy.id}/versions/${version.id}`}>
                {payer.name} {policy.externalPolicyId} v{version.versionNumber}
              </Link>{" "}
              <span className="text-slate-500">· {document.split("/").pop()} has a new hash. Re-read it and publish a new version if the policy changed.</span>
            </li>
          ))}
        </Panel>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Demo:
        {gaps.sourceChanged.length === 0 ? (
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => api.observeSourceHash("fixtures/policies/insurer-policy-excerpts.pdf", "0".repeat(64))}>
            Simulate the insurer updating its PDF
          </Button>
        ) : (
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => api.observeSourceHash("fixtures/policies/insurer-policy-excerpts.pdf", SEED_PDF_HASH)}>
            Undo simulated change
          </Button>
        )}
      </div>
    </Card>
  );
}

function Panel({ icon, title, count, empty, children }: { icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="bg-white px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <span className="text-slate-400">{icon}</span> {title}
        <span className="ml-auto rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">{count}</span>
      </h3>
      {count === 0 ? <p className="text-xs text-slate-400">{empty}</p> : <ul className="space-y-1 text-sm text-slate-800">{children}</ul>}
    </section>
  );
}

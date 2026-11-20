import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, Copy, ExternalLink, FileText, GitCompare, History, Pencil, Undo2 } from "lucide-react";
import { RuleView } from "@/components/rules/RuleView";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { AssumptionBadge, Banner, Button, Card, EmptyState, OverallBadge, Pill, SectionTitle, VersionStatusBadge } from "@/components/rules/ui";
import { ApiError, type VersionView } from "@/data/rules/service";
import { useRulesUser } from "@/lib/rulesUser";
import { effectiveRange, fmtDateTime } from "@/lib/rulesFormat";
import { sourceDocumentUrl } from "@/lib/sourceDocs";
import { useRules } from "@/lib/useRules";

export default function PolicyDetail() {
  const { policyId = "", versionId } = useParams();
  const api = useRules();
  const { user } = useRulesUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<{ message: string; draftId?: string } | null>(null);
  const { hash } = useLocation();

  // Deep links from an evaluation (…#criterion-prior_xray) scroll to the criterion.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [hash, versionId]);

  let detail: ReturnType<typeof api.getPolicy>;
  try {
    detail = api.getPolicy(policyId);
  } catch {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-6">
        <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: "Not found" }]} />
        <EmptyState>That policy does not exist.</EmptyState>
      </main>
    );
  }
  const { policy, payer, versions, openDraft, active } = detail;
  const latestPublished = versions.find((v) => v.status === "published");
  const selected = versions.find((v) => v.id === versionId) ?? active ?? versions.find((v) => v.derivedStatus === "scheduled") ?? latestPublished ?? openDraft ?? versions[0];
  const tab = params.get("tab") === "usage" ? "usage" : "rules";
  const pdf = sourceDocumentUrl(selected?.sourceDocument ?? null);

  const start = (cloneFrom?: string, kind?: "clone" | "rollback") => {
    try {
      const draft = api.createDraft(policyId, { actor: user, cloneFrom, kind });
      navigate(`/settings/rules/${policyId}/versions/${draft.id}/edit`);
    } catch (e) {
      if (e instanceof ApiError) setError({ message: e.message, draftId: (e.details as { existingDraftId?: string } | undefined)?.existingDraftId });
      else throw e;
    }
  };

  const archive = (v: VersionView) => {
    if (!window.confirm(`Archive draft v${v.versionNumber}? It will no longer be editable.`)) return;
    try {
      api.archiveVersion(v.id, user);
      if (v.id === versionId) navigate(`/settings/rules/${policyId}`);
    } catch (e) {
      if (e instanceof ApiError) setError({ message: e.message });
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 py-6">
      <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: `${payer.name} ${policy.externalPolicyId}` }]} />

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-xs text-slate-500">{payer.name}</div>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              <span className="font-mono text-base text-slate-500">{policy.externalPolicyId}</span> {policy.title}
              {active ? <Pill tone="emerald">Active: v{active.versionNumber}</Pill> : <Pill tone="slate">No active version</Pill>}
              {openDraft && (
                <Link to={`/settings/rules/${policyId}/versions/${openDraft.id}/edit`}>
                  <Pill tone="amber">Draft v{openDraft.versionNumber} in progress</Pill>
                </Link>
              )}
            </h1>
            {pdf && (
              <a href={pdf} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline">
                <FileText size={14} /> Source policy PDF{selected?.sourceRevisionLabel ? ` (${selected.sourceRevisionLabel})` : ""} <ExternalLink size={12} />
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {openDraft ? (
              <Button variant="primary" onClick={() => navigate(`/settings/rules/${policyId}/versions/${openDraft.id}/edit`)}>
                <Pencil size={14} /> Continue draft v{openDraft.versionNumber}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => start()} disabled={!latestPublished}>
                <Pencil size={14} /> Start new draft
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="mb-4">
          <Banner tone="amber" action={error.draftId ? <Link className="shrink-0 text-sm font-medium underline" to={`/settings/rules/${policyId}/versions/${error.draftId}/edit`}>Open the draft</Link> : undefined}>
            {error.message}
          </Banner>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside aria-label="Version timeline">
          <SectionTitle>Versions</SectionTitle>
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {versions.map((v) => {
              const isSel = v.id === selected?.id;
              const others = versions.filter((o) => o.id !== v.id);
              const dot = v.derivedStatus === "active" ? "bg-emerald-500" : v.derivedStatus === "draft" ? "bg-amber-500" : v.derivedStatus === "scheduled" ? "bg-sky-500" : "bg-slate-300";
              return (
                <li key={v.id} className="relative">
                  <span className={`absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot}`} />
                  <Card className={isSel ? "ring-2 ring-indigo-200" : ""}>
                    <div className="space-y-1.5 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">v{v.versionNumber}</span>
                        <VersionStatusBadge status={v.derivedStatus} />
                        {(v.criteria.some((c) => c.isAssumption) || v.exceptions.some((e) => e.isAssumption)) && <AssumptionBadge title="Contains assumptions" />}
                      </div>
                      <div className="text-xs text-slate-600">{effectiveRange(v)}</div>
                      {v.sourceRevisionLabel && <div className="text-xs text-slate-500">Insurer: {v.sourceRevisionLabel}</div>}
                      <p className="text-xs text-slate-700">{v.changeNote ?? <em className="text-slate-400">No change note yet</em>}</p>
                      <div className="text-[11px] text-slate-500">
                        {v.publishedBy ? `Published by ${v.publishedBy} · ${fmtDateTime(v.publishedAt!)}` : `Edited by ${v.lastEditedBy} · ${fmtDateTime(v.updatedAt)}`}
                      </div>
                      {v.clonedFromVersionId && <div className="text-[11px] text-slate-500">Cloned from v{versions.find((x) => x.id === v.clonedFromVersionId)?.versionNumber}</div>}
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        {v.derivedStatus === "draft" ? (
                          <>
                            <Link to={`/settings/rules/${policyId}/versions/${v.id}/edit`} className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Edit</Link>
                            <Link to={`/settings/rules/${policyId}/versions/${v.id}`} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">View</Link>
                            <button type="button" onClick={() => archive(v)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"><Archive size={12} /> Archive draft</button>
                          </>
                        ) : (
                          <>
                            <Link to={`/settings/rules/${policyId}/versions/${v.id}`} className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">View</Link>
                            {v.status === "published" && (
                              <button type="button" onClick={() => start(v.id)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"><Copy size={12} /> Clone to new draft</button>
                            )}
                            {v.status === "published" && latestPublished && v.id !== latestPublished.id && (
                              <button type="button" title="Creates a new draft identical to this version. Publish it to roll back; history stays intact." onClick={() => start(v.id, "rollback")} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"><Undo2 size={12} /> Roll back to this</button>
                            )}
                          </>
                        )}
                        {others.length > 0 && (
                          <select
                            aria-label={`Compare v${v.versionNumber} with`}
                            value=""
                            onChange={(e) => {
                              const other = versions.find((o) => o.id === e.target.value);
                              if (!other) return;
                              const [a, b] = other.versionNumber < v.versionNumber ? [other, v] : [v, other];
                              navigate(`/settings/rules/${policyId}/compare?a=${a.id}&b=${b.id}`);
                            }}
                            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600"
                          >
                            <option value="">Compare with…</option>
                            {others.map((o) => <option key={o.id} value={o.id}>v{o.versionNumber}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        </aside>

        <section aria-label="Selected version" className="min-w-0">
          {selected ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">v{selected.versionNumber}</h2>
                  <VersionStatusBadge status={selected.derivedStatus} />
                  <span className="text-xs text-slate-500">{effectiveRange(selected)}</span>
                </div>
                <div className="flex items-center gap-1 text-sm">
                  {(["rules", "usage"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setParams(t === "rules" ? {} : { tab: t })}
                      aria-current={tab === t ? "page" : undefined}
                      className={`rounded-md px-3 py-1 ${tab === t ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      {t === "rules" ? "Readable rules" : "Usage"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-5 py-4">
                {tab === "rules" ? <RulesTab version={selected} policyId={policyId} /> : <UsageTab policyId={policyId} versions={versions} />}
              </div>
            </Card>
          ) : (
            <EmptyState>No versions yet.</EmptyState>
          )}
        </section>
      </div>
    </main>
  );
}

function RulesTab({ version, policyId }: { version: VersionView; policyId: string }) {
  const api = useRules();
  const log = api.getAudit(version.id);
  return (
    <div className="space-y-6">
      {version.derivedStatus === "draft" && (
        <Banner tone="amber" action={<Link to={`/settings/rules/${policyId}/versions/${version.id}/edit`} className="shrink-0 text-sm font-medium underline">Open editor</Link>}>
          This is a draft. It does not affect any evaluation until it is published.
        </Banner>
      )}
      {version.derivedStatus === "superseded" && <Banner tone="sky">This version was superseded on {version.effectiveTo}. Evaluations that used it still link here.</Banner>}
      {version.changeNote && (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">Change note:</span> {version.changeNote}
        </p>
      )}
      <RuleView data={version} />
      <section>
        <SectionTitle aside={<History size={13} className="text-slate-400" />}>Audit trail</SectionTitle>
        {log.length === 0 ? (
          <p className="text-sm text-slate-400">No entries.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {log.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2 text-slate-700">
                <span className="text-xs text-slate-400">{fmtDateTime(a.timestamp)}</span>
                <span className="font-medium">{a.actor}</span>
                <span>{a.action.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div>
        <Link to={`/settings/rules/${policyId}/compare?b=${version.id}`} className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline">
          <GitCompare size={14} /> Compare this version with another
        </Link>
      </div>
    </div>
  );
}

function UsageTab({ policyId, versions }: { policyId: string; versions: VersionView[] }) {
  const api = useRules();
  const navigate = useNavigate();
  const evals = api.listEvaluations({ policyId });
  const { testCases, policy } = api.getPolicy(policyId);
  const [testId, setTestId] = useState("");
  const [date, setDate] = useState("");
  const chosen = testCases.find((t) => t.id === (testId || testCases[0]?.id));
  const vnum = (id: string | null) => versions.find((v) => v.id === id)?.versionNumber;

  const run = () => {
    if (!chosen) return;
    const ev = api.evaluate(
      { payerId: policy.payerId, ...chosen.input, serviceDate: date || chosen.input.serviceDate },
      { patientRef: "Test patient", orderRef: `TEST-${chosen.name.slice(0, 12).replace(/\W+/g, "-").toUpperCase()}` },
    );
    navigate(`/evaluations/${ev.id}`);
  };

  return (
    <div className="space-y-5">
      {chosen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-medium text-slate-700">Run a test case as a real evaluation</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-600">
              Test case
              <select value={chosen.id} onChange={(e) => { setTestId(e.target.value); setDate(""); }} className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                {testCases.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Service date
              <input type="date" value={date || chosen.input.serviceDate} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
            </label>
            <Button onClick={run}>Run evaluation</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">The service date decides which version governs: earlier dates resolve to the older version, later dates to the newer one.</p>
        </div>
      )}
      {evals.length === 0 ? (
        <EmptyState>No evaluations have used this policy yet.</EmptyState>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              {["Evaluation", "Order", "Patient", "Service date", "Version", "Result"].map((h) => (
                <th key={h} className="py-2 pr-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evals.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4"><Link to={`/evaluations/${e.id}`} className="text-indigo-700 hover:underline">{e.id.replace("eval_", "#")}</Link></td>
                <td className="py-2 pr-4">{e.orderRef}</td>
                <td className="py-2 pr-4">{e.patientRef}</td>
                <td className="py-2 pr-4 tabular">{e.serviceDate}</td>
                <td className="py-2 pr-4"><Link to={`/settings/rules/${policyId}/versions/${e.policyVersionId}`} className="hover:underline">v{vnum(e.policyVersionId)}</Link></td>
                <td className="py-2 pr-4"><OverallBadge overall={e.overall} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

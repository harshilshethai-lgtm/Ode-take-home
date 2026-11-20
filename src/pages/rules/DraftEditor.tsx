import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, Archive, CircleCheck, Code, GitCompare, LoaderCircle, Play, Plus, Send, Trash2 } from "lucide-react";
import { ChipInput, CheckGroup, Field, SchemaForm, inputCls } from "@/components/rules/fields";
import { RuleView } from "@/components/rules/RuleView";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { TestResults } from "@/components/rules/TestResults";
import { AssumptionBadge, Banner, Button, Card, EmptyState, SectionTitle } from "@/components/rules/ui";
import { ApiError, type VersionView } from "@/data/rules/service";
import { humanize } from "@/domain/rules/common";
import { describeCriterion, planTypeLabel } from "@/domain/rules/describe";
import { cleanParams } from "@/domain/rules/schemaFields";
import { getPrimitive, listPrimitives } from "@/domain/rules/primitives/registry";
import type { TestRunResult } from "@/domain/rules/testRunner";
import type {
  Channel,
  Criterion,
  EvaluationMode,
  IncompleteHandling,
  PolicyException,
  Setting,
  ValidationIssue,
  VersionEditableFields,
} from "@/domain/rules/types";
import { useRulesUser } from "@/lib/rulesUser";
import { useRules } from "@/lib/useRules";
import PublishModal from "./PublishModal";

const pick = (v: VersionView): VersionEditableFields => ({
  applicability: v.applicability,
  logic: v.logic,
  submission: v.submission,
  criteria: v.criteria,
  exceptions: v.exceptions,
  sourceRevisionLabel: v.sourceRevisionLabel,
  sourceDocument: v.sourceDocument,
  sourceDocumentHash: v.sourceDocumentHash,
  changeNote: v.changeNote,
  effectiveFrom: v.effectiveFrom,
});

let localSeq = 0;
const localId = (p: string) => `local_${p}_${Date.now().toString(36)}_${++localSeq}`;

export default function DraftEditor() {
  const { policyId = "", versionId = "" } = useParams();
  const api = useRules();
  let loaded: ReturnType<typeof api.getVersion>;
  try {
    loaded = api.getVersion(policyId, versionId);
  } catch {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-6">
        <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: "Not found" }]} />
        <EmptyState>That version does not exist.</EmptyState>
      </main>
    );
  }
  // Remount the editor body if the route changes to another version.
  return <Editor key={versionId} initial={loaded.version} policyName={`${loaded.payer.name} ${loaded.policy.externalPolicyId}`} policyTitle={loaded.policy.title} policyId={policyId} />;
}

type SaveState = "saved" | "dirty" | "saving";

function Editor({ initial, policyId, policyName, policyTitle }: { initial: VersionView; policyId: string; policyName: string; policyTitle: string }) {
  const api = useRules();
  const { user } = useRulesUser();
  const navigate = useNavigate();
  const isDraft = initial.status === "draft";

  const [fields, setFields] = useState<VersionEditableFields>(() => pick(initial));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [tests, setTests] = useState<TestRunResult | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = useRef(initial);
  const latest = useRef(fields);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  /* ---- autosave ---- */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !isDraft) return;
    try {
      api.patchVersion(initial.id, latest.current, user);
      dirty.current = false;
      setSaveState("saved");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    }
  }, [api, initial.id, isDraft, user]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []); // save on leaving the page

  const update = (next: VersionEditableFields | ((f: VersionEditableFields) => VersionEditableFields)) => {
    setFields((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      latest.current = value;
      return value;
    });
    dirty.current = true;
    setSaveState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSaveState("saving");
      flushRef.current();
    }, 600);
  };

  /* ---- validation (live, on the in-memory state) ---- */
  const validation = useMemo(
    () => api.validateVersion(initial.id, undefined, fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, initial.id],
  );
  const errorsFor = (prefix: string): ValidationIssue[] => validation.errors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`));
  const canPublish = validation.errors.length === 0;

  if (!isDraft) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-6">
        <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: policyName, to: `/settings/rules/${policyId}` }, { label: `v${initial.versionNumber}` }]} />
        <Banner tone="amber">
          v{initial.versionNumber} is {initial.derivedStatus} and cannot be edited (published versions are immutable).{" "}
          <Link to={`/settings/rules/${policyId}/versions/${initial.id}`} className="font-medium underline">View it</Link>, or start a new draft from it on the policy page.
        </Banner>
      </main>
    );
  }

  const policy = api.getPolicy(policyId);
  const active = policy.active;
  const asVersion = { ...initial, ...fields };

  const runTests = () => {
    flush();
    try {
      setTests(api.testVersion(initial.id, user));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not run tests.");
    }
  };

  const archive = () => {
    if (!window.confirm("Archive this draft? It will no longer be editable.")) return;
    dirty.current = false;
    try {
      api.archiveVersion(initial.id, user);
      navigate(`/settings/rules/${policyId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not archive.");
    }
  };

  /* ---- field updaters ---- */
  const setCriterion = (id: string, patch: Partial<Criterion>) =>
    update((f) => {
      const old = f.criteria.find((c) => c.id === id);
      let exceptions = f.exceptions;
      // Renaming a (new) criterion keeps the waivers that pointed at it.
      if (old && patch.key !== undefined && patch.key !== old.key) {
        exceptions = exceptions.map((e) => ({ ...e, waivesCriterionKeys: e.waivesCriterionKeys.map((k) => (k === old.key ? patch.key! : k)) }));
      }
      return { ...f, exceptions, criteria: f.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    });
  const moveCriterion = (i: number, dir: -1 | 1) =>
    update((f) => {
      const next = [...f.criteria];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, criteria: next.map((c, k) => ({ ...c, sortOrder: k })) };
    });
  const removeCriterion = (c: Criterion) => {
    if (!window.confirm(`Remove "${c.displayLabel || c.key}"? Any exception that waives it will stop waiving it.`)) return;
    update((f) => ({
      ...f,
      criteria: f.criteria.filter((x) => x.id !== c.id),
      exceptions: f.exceptions.map((e) => ({ ...e, waivesCriterionKeys: e.waivesCriterionKeys.filter((k) => k !== c.key) })),
    }));
  };
  const addCriterion = () =>
    update((f) => {
      let n = f.criteria.length + 1;
      while (f.criteria.some((c) => c.key === `criterion_${n}`)) n++;
      const prim = listPrimitives()[0];
      const c: Criterion = {
        id: localId("crit"),
        policyVersionId: initial.id,
        key: `criterion_${n}`,
        displayLabel: "",
        type: prim.type,
        params: structuredClone(prim.defaultParams) as Record<string, unknown>,
        evaluationMode: "auto",
        sourceCitation: { section: "", excerpt: "" },
        interpretationNote: null,
        isAssumption: false,
        sortOrder: f.criteria.length,
      };
      return { ...f, criteria: [...f.criteria, c] };
    });

  const setException = (id: string, patch: Partial<PolicyException>) => update((f) => ({ ...f, exceptions: f.exceptions.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const addException = () =>
    update((f) => {
      let n = f.exceptions.length + 1;
      while (f.exceptions.some((e) => e.key === `exception_${n}`)) n++;
      const e: PolicyException = {
        id: localId("exc"),
        policyVersionId: initial.id,
        key: `exception_${n}`,
        displayLabel: "",
        triggers: [],
        waivesCriterionKeys: [],
        evaluationMode: "human_review",
        sourceCitation: { section: "", excerpt: "" },
        interpretationNote: null,
        isAssumption: false,
      };
      return { ...f, exceptions: [...f.exceptions, e] };
    });

  const originalCriterionIds = new Set(original.current.criteria.map((c) => c.id));
  const originalExceptionIds = new Set(original.current.exceptions.map((e) => e.id));

  return (
    <main className="mx-auto w-full max-w-[1480px] px-6 py-6">
      <RulesHeader crumbs={[{ label: "Prior-auth rules", to: "/settings/rules" }, { label: policyName, to: `/settings/rules/${policyId}` }, { label: `Edit draft v${initial.versionNumber}` }]} />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Draft v{initial.versionNumber} <span className="font-normal text-slate-500">· {policyTitle}</span>
          </h1>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            {saveState === "saved" ? (
              <span className="inline-flex items-center gap-1 text-emerald-700"><CircleCheck size={14} /> Saved</span>
            ) : (
              <span className="inline-flex items-center gap-1"><LoaderCircle size={14} className="animate-spin" /> Saving…</span>
            )}
            {initial.clonedFromVersionId && <span>· started from v{policy.versions.find((v) => v.id === initial.clonedFromVersionId)?.versionNumber}</span>}
            <span>· autosaves as you type</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runTests}><Play size={14} /> Run tests</Button>
          {active && (
            <Button
              onClick={() => {
                flush();
                navigate(`/settings/rules/${policyId}/compare?a=${active.id}&b=${initial.id}`);
              }}
            >
              <GitCompare size={14} /> Compare with v{active.versionNumber}
            </Button>
          )}
          <Button variant="danger" onClick={archive}><Archive size={14} /> Archive draft</Button>
          <Button variant="primary" disabled={!canPublish} title={canPublish ? "" : "Fix the errors below first"} onClick={() => { flush(); setPublishing(true); }}>
            <Send size={14} /> Publish…
          </Button>
        </div>
      </div>

      {error && <div className="mb-4"><Banner tone="rose">{error}</Banner></div>}

      <ValidationSummary errors={validation.errors} warnings={validation.warnings} />

      {tests && (
        <Card className="mb-5">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Test results</h2>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setTests(null)}>Dismiss</button>
          </div>
          <div className="p-4"><TestResults result={tests} candidateLabel={`Draft v${initial.versionNumber}`} /></div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="space-y-4 px-5 py-4">
              <SectionTitle>Source</SectionTitle>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Insurer's revision label" help='e.g. "Rev. 3" or "Effective 01/01/2026"'>
                  <input value={fields.sourceRevisionLabel ?? ""} onChange={(e) => update((f) => ({ ...f, sourceRevisionLabel: e.target.value || null }))} className={inputCls} />
                </Field>
                <Field label="Source document" help="File path or URL of the insurer's policy">
                  <input value={fields.sourceDocument ?? ""} onChange={(e) => update((f) => ({ ...f, sourceDocument: e.target.value || null }))} className={inputCls} />
                </Field>
                <Field label="Source document hash" help="Lets us notice when the insurer changes the document">
                  <input value={fields.sourceDocumentHash ?? ""} onChange={(e) => update((f) => ({ ...f, sourceDocumentHash: e.target.value || null }))} className={`${inputCls} font-mono text-xs`} />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-4 px-5 py-4">
              <SectionTitle>Applies to</SectionTitle>
              <ApplicabilityEditor fields={fields} update={update} errors={errorsFor("applicability")} />
            </div>
          </Card>

          <section aria-label="Criteria">
            <SectionTitle aside={<span className="text-xs text-slate-500">All of these must be documented</span>}>Criteria</SectionTitle>
            <div className="space-y-4">
              {fields.criteria.map((c, i) => (
                <CriterionCard
                  key={c.id}
                  index={i}
                  total={fields.criteria.length}
                  c={c}
                  keyLocked={originalCriterionIds.has(c.id)}
                  errors={errorsFor(`criteria.${c.key || c.id}`)}
                  onChange={(patch) => setCriterion(c.id, patch)}
                  onMove={(d) => moveCriterion(i, d)}
                  onRemove={() => removeCriterion(c)}
                />
              ))}
              <Button onClick={addCriterion}><Plus size={14} /> Add criterion</Button>
            </div>
          </section>

          <section aria-label="Exceptions">
            <SectionTitle aside={<span className="text-xs text-slate-500">Each lists exactly the criteria it waives</span>}>Exceptions</SectionTitle>
            <div className="space-y-4">
              {fields.exceptions.map((e) => (
                <ExceptionCard
                  key={e.id}
                  e={e}
                  criteria={fields.criteria}
                  keyLocked={originalExceptionIds.has(e.id)}
                  errors={errorsFor(`exceptions.${e.key || e.id}`)}
                  onChange={(patch) => setException(e.id, patch)}
                  onRemove={() => window.confirm(`Remove exception "${e.displayLabel || e.key}"?`) && update((f) => ({ ...f, exceptions: f.exceptions.filter((x) => x.id !== e.id) }))}
                />
              ))}
              <Button onClick={addException}><Plus size={14} /> Add exception</Button>
            </div>
          </section>

          <Card>
            <div className="space-y-4 px-5 py-4">
              <SectionTitle>Submission</SectionTitle>
              <SubmissionEditor fields={fields} update={update} />
              <Field label="Change note" help="Required to publish. Describe what changed and why.">
                <textarea rows={2} value={fields.changeNote ?? ""} onChange={(e) => update((f) => ({ ...f, changeNote: e.target.value || null }))} className={inputCls} />
              </Field>
            </div>
          </Card>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start" aria-label="Live preview">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold">{showJson ? "Advanced: JSON (read-only)" : "Live preview"}</h2>
              <button type="button" onClick={() => setShowJson((s) => !s)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                <Code size={13} /> {showJson ? "Back to preview" : "Advanced"}
              </button>
            </div>
            <div className="max-h-[calc(100vh-8rem)] overflow-auto p-4">
              {showJson ? (
                <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(fields, null, 2)}</pre>
              ) : (
                <RuleView data={asVersion} compact />
              )}
            </div>
          </Card>
        </aside>
      </div>

      {publishing && (
        <PublishModal
          version={api.getVersion(policyId, initial.id).version}
          onClose={() => setPublishing(false)}
          onPublished={(v) => {
            dirty.current = false;
            navigate(`/settings/rules/${policyId}/versions/${v.id}`);
          }}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ pieces */

function ValidationSummary({ errors, warnings }: { errors: ValidationIssue[]; warnings: ValidationIssue[] }) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mb-5 space-y-2">
      {errors.length > 0 && (
        <Banner tone="rose">
          <div className="mb-1 font-medium">{errors.length} thing{errors.length === 1 ? "" : "s"} to fix before this can be published</div>
          <ul className="list-disc space-y-0.5 pl-4">{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="amber">
          <div className="mb-1 font-medium">{warnings.length} warning{warnings.length === 1 ? "" : "s"} (publishing is still allowed)</div>
          <ul className="list-disc space-y-0.5 pl-4">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Banner>
      )}
    </div>
  );
}

function CardErrors({ errors }: { errors: ValidationIssue[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      {errors.map((e, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {e.message}</li>)}
    </ul>
  );
}

const MODE_LABEL: Record<EvaluationMode, string> = { auto: "Automatic", human_review: "Human review" };

function CitationFields({ value, onChange, invalid }: { value: { section: string; excerpt: string }; onChange: (v: { section: string; excerpt: string }) => void; invalid: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-[160px_1fr]">
      <Field label="Policy section" error={invalid && !value.section.trim()}>
        <input value={value.section} onChange={(e) => onChange({ ...value, section: e.target.value })} placeholder="e.g. §2b" className={`${inputCls} ${invalid && !value.section.trim() ? "border-rose-400" : ""}`} />
      </Field>
      <Field label="Verbatim insurer text (required)" help="Paste the exact wording this rule encodes." error={invalid && !value.excerpt.trim()}>
        <textarea rows={2} value={value.excerpt} onChange={(e) => onChange({ ...value, excerpt: e.target.value })} className={`${inputCls} ${invalid && !value.excerpt.trim() ? "border-rose-400" : ""}`} />
      </Field>
    </div>
  );
}

function AssumptionFields({
  note,
  isAssumption,
  onChange,
}: {
  note: string | null;
  isAssumption: boolean;
  onChange: (patch: { interpretationNote?: string | null; isAssumption?: boolean }) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label="Interpretation note" help="Where did you have to interpret ambiguous policy language?">
        <textarea rows={2} value={note ?? ""} onChange={(e) => onChange({ interpretationNote: e.target.value || null })} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={isAssumption} onChange={(e) => onChange({ isAssumption: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-amber-600" />
        This is an assumption (a guess, not something the policy states) <AssumptionBadge />
      </label>
    </div>
  );
}

function CriterionCard({
  c, index, total, keyLocked, errors, onChange, onMove, onRemove,
}: {
  c: Criterion; index: number; total: number; keyLocked: boolean; errors: ValidationIssue[];
  onChange: (patch: Partial<Criterion>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const prim = getPrimitive(c.type);
  const invalidFields = errors.filter((e) => e.code === "criterion.params.invalid").map((e) => e.path.split(".params.")[1]?.split(".")[0] ?? "");
  const citationInvalid = errors.some((e) => e.code === "criterion.citation.missing");

  return (
    <Card>
      <div className="space-y-4 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
              <span className="truncate font-medium">{c.displayLabel || <em className="text-slate-400">Untitled criterion</em>}</span>
              {c.isAssumption && <AssumptionBadge />}
            </div>
            <p className="ml-7 mt-0.5 text-sm text-slate-600">{describeCriterion(c)}</p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            <Button variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="!px-1.5"><ArrowUp size={14} /></Button>
            <Button variant="ghost" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)} className="!px-1.5"><ArrowDown size={14} /></Button>
            <Button variant="ghost" aria-label="Remove criterion" onClick={onRemove} className="!px-1.5 text-rose-600"><Trash2 size={14} /></Button>
          </div>
        </div>

        <CardErrors errors={errors} />

        <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px]">
          <Field label="Label shown to staff">
            <input value={c.displayLabel} onChange={(e) => onChange({ displayLabel: e.target.value })} placeholder="e.g. 2b. Conservative treatment" className={inputCls} />
          </Field>
          <Field label="Rule type" help={prim?.summary}>
            <select
              value={c.type}
              onChange={(e) => {
                const next = getPrimitive(e.target.value);
                if (next) onChange({ type: next.type, params: structuredClone(next.defaultParams) as Record<string, unknown> });
              }}
              className={inputCls}
            >
              {!prim && <option value={c.type}>{c.type} (unknown)</option>}
              {listPrimitives().map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Evaluation">
            <select value={c.evaluationMode} onChange={(e) => onChange({ evaluationMode: e.target.value as EvaluationMode })} className={inputCls}>
              {(Object.keys(MODE_LABEL) as EvaluationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </Field>
        </div>

        {prim && (
          <div className="rounded-lg bg-slate-50 p-3">
            <SchemaForm schema={prim.paramsSchema} value={c.params} onChange={(p) => onChange({ params: cleanParams(p) })} invalidFields={invalidFields} />
          </div>
        )}

        <CitationFields value={c.sourceCitation} onChange={(sourceCitation) => onChange({ sourceCitation })} invalid={citationInvalid} />
        <AssumptionFields note={c.interpretationNote} isAssumption={c.isAssumption} onChange={onChange} />

        <Field label="Key" help={keyLocked ? "Keys carry over from earlier versions so comparisons line up. This one is locked." : "A short identifier that stays the same across versions, e.g. symptom_duration."}>
          <input
            value={c.key}
            disabled={keyLocked}
            onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") })}
            className={`${inputCls} max-w-xs font-mono text-xs`}
          />
        </Field>
      </div>
    </Card>
  );
}

function ExceptionCard({
  e, criteria, keyLocked, errors, onChange, onRemove,
}: {
  e: PolicyException; criteria: Criterion[]; keyLocked: boolean; errors: ValidationIssue[];
  onChange: (patch: Partial<PolicyException>) => void; onRemove: () => void;
}) {
  const citationInvalid = errors.some((x) => x.code === "exception.citation.missing");
  const labelFor = (k: string) => criteria.find((c) => c.key === k)?.displayLabel || k;
  // Keep dangling keys visible so they can be seen and unticked, not silently dropped.
  const options = [...new Set([...criteria.map((c) => c.key), ...e.waivesCriterionKeys])];
  return (
    <Card>
      <div className="space-y-4 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{e.displayLabel || <em className="text-slate-400">Untitled exception</em>}</span>
            {e.isAssumption && <AssumptionBadge />}
          </div>
          <Button variant="ghost" aria-label="Remove exception" onClick={onRemove} className="!px-1.5 text-rose-600"><Trash2 size={14} /></Button>
        </div>
        <CardErrors errors={errors} />
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <Field label="Label shown to staff">
            <input value={e.displayLabel} onChange={(ev) => onChange({ displayLabel: ev.target.value })} placeholder="e.g. 3. Red-flag conditions" className={inputCls} />
          </Field>
          <Field label="Evaluation" help="Use human review when triggers need clinical judgment.">
            <select value={e.evaluationMode} onChange={(ev) => onChange({ evaluationMode: ev.target.value as EvaluationMode })} className={inputCls}>
              {(Object.keys(MODE_LABEL) as EvaluationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">If any of these is documented…</span>
          <ChipInput
            ariaLabel="Triggers"
            value={e.triggers}
            onChange={(triggers) => onChange({ triggers })}
            format={humanize}
            normalize={(s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}
            placeholder="Type a condition and press Enter, e.g. locked knee"
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">…then these criteria are waived</span>
          {options.length === 0 ? <p className="text-sm text-slate-500">Add criteria first.</p> : <CheckGroup options={options} value={e.waivesCriterionKeys} onChange={(waivesCriterionKeys) => onChange({ waivesCriterionKeys })} labelFor={labelFor} />}
        </div>
        <CitationFields value={e.sourceCitation} onChange={(sourceCitation) => onChange({ sourceCitation })} invalid={citationInvalid} />
        <AssumptionFields note={e.interpretationNote} isAssumption={e.isAssumption} onChange={onChange} />
        <Field label="Key" help={keyLocked ? "Keys carry over from earlier versions so comparisons line up. This one is locked." : "A short identifier that stays the same across versions."}>
          <input value={e.key} disabled={keyLocked} onChange={(ev) => onChange({ key: ev.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") })} className={`${inputCls} max-w-xs font-mono text-xs`} />
        </Field>
      </div>
    </Card>
  );
}

const KNOWN_PLANS = ["commercial_hmo", "commercial_ppo", "commercial_epo", "medicare_advantage", "medicaid_managed_care"];

function ApplicabilityEditor({ fields, update, errors }: { fields: VersionEditableFields; update: (f: (p: VersionEditableFields) => VersionEditableFields) => void; errors: ValidationIssue[] }) {
  const a = fields.applicability;
  const set = (patch: Partial<typeof a>) => update((f) => ({ ...f, applicability: { ...f.applicability, ...patch } }));
  return (
    <div className="space-y-4">
      <CardErrors errors={errors} />
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-700">CPT codes</span>
        <ChipInput ariaLabel="CPT codes" value={a.cptCodes} onChange={(cptCodes) => set({ cptCodes })} normalize={(s) => s.trim().toUpperCase()} placeholder="e.g. 72148" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">Plan types</span>
          <label className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="plans" checked={a.planTypes === "all"} onChange={() => set({ planTypes: "all" })} /> All plans</label>
          <label className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="plans" checked={a.planTypes !== "all"} onChange={() => set({ planTypes: [] })} /> Only these</label>
          {a.planTypes !== "all" && (
            <div className="mt-2">
              <CheckGroup options={[...new Set([...KNOWN_PLANS, ...a.planTypes])]} value={a.planTypes} onChange={(planTypes) => set({ planTypes })} labelFor={planTypeLabel} />
            </div>
          )}
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">Settings</span>
          <label className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="settings" checked={a.settings === "all"} onChange={() => set({ settings: "all" })} /> All settings</label>
          <label className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name="settings" checked={a.settings !== "all"} onChange={() => set({ settings: ["outpatient"] })} /> Only these</label>
          {a.settings !== "all" && (
            <div className="mt-2"><CheckGroup options={["outpatient", "inpatient"]} value={a.settings} onChange={(settings) => set({ settings: settings as Setting[] })} labelFor={(s) => s[0].toUpperCase() + s.slice(1)} /></div>
          )}
        </div>
      </div>
    </div>
  );
}

const CHANNELS: Channel[] = ["portal", "api", "fax"];
const INCOMPLETE: Array<[IncompleteHandling, string]> = [
  ["amendable", "Can be amended after submission"],
  ["deny_resubmit_new", "Denied; must be resubmitted as a new request"],
  ["unspecified", "Policy does not say"],
];

function SubmissionEditor({ fields, update }: { fields: VersionEditableFields; update: (f: (p: VersionEditableFields) => VersionEditableFields) => void }) {
  const s = fields.submission;
  const set = (patch: Partial<typeof s>) => update((f) => ({ ...f, submission: { ...f.submission, ...patch } }));
  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-700">Accepted channels</span>
        <CheckGroup options={CHANNELS} value={s.channels} onChange={(channels) => set({ channels: channels as Channel[] })} labelFor={(c) => (c === "api" ? "API" : c[0].toUpperCase() + c.slice(1))} />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-700">Required attachments</span>
        <ChipInput ariaLabel="Required attachments" value={s.requiredAttachments} onChange={(requiredAttachments) => set({ requiredAttachments })} placeholder="e.g. most recent office note" />
      </div>
      <Field label="Incomplete requests">
        <select value={s.incompleteRequestHandling} onChange={(e) => set({ incompleteRequestHandling: e.target.value as IncompleteHandling })} className={`${inputCls} max-w-md`}>
          {INCOMPLETE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
    </div>
  );
}

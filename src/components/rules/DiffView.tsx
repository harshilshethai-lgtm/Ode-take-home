import type { CriterionDiff, ExceptionDiff, ValueChange, VersionDiff } from "@/domain/rules/diff";
import { DiffText, Pill, SectionTitle } from "./ui";

const KIND: Record<string, { tone: "emerald" | "rose" | "amber" | "slate"; label: string }> = {
  added: { tone: "emerald", label: "Added" },
  removed: { tone: "rose", label: "Removed" },
  changed: { tone: "amber", label: "Changed" },
  unchanged: { tone: "slate", label: "Unchanged" },
};

function ChangeChips({ changes }: { changes: ValueChange[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {changes.map((c, i) => (
        <li
          key={i}
          className={`rounded-md px-2 py-1 text-xs ring-1 ring-inset ${c.emphasis === "waiver_scope" ? "bg-rose-50 text-rose-800 ring-rose-300" : "bg-amber-50 text-amber-900 ring-amber-200"}`}
        >
          <span className="font-medium">{c.label}:</span> <span className="line-through opacity-70">{c.from}</span> → <strong>{c.to}</strong>
          {c.emphasis === "waiver_scope" && <span className="ml-1 font-semibold">(waiver scope changed)</span>}
        </li>
      ))}
    </ul>
  );
}

function CriterionRow({ c }: { c: CriterionDiff }) {
  const k = KIND[c.kind];
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill tone={k.tone}>{k.label}</Pill>
        <span className="font-medium text-slate-900">{c.label}</span>
        <code className="rounded bg-slate-100 px-1 text-[11px] text-slate-500">{c.key}</code>
      </div>
      {c.kind === "unchanged" ? (
        <p className="text-sm text-slate-500">{c.after?.text}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-2.5 text-sm text-slate-800">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Before</div>
            {c.before ? c.segments ? <DiffText segs={c.segments.before} side="before" /> : c.before.text : <span className="text-slate-400">(not in this version)</span>}
          </div>
          <div className="rounded-md bg-slate-50 p-2.5 text-sm text-slate-800">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">After</div>
            {c.after ? c.segments ? <DiffText segs={c.segments.after} side="after" /> : c.after.text : <span className="text-slate-400">(removed)</span>}
          </div>
        </div>
      )}
      <ChangeChips changes={c.changes} />
      {c.citationChanges.length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
          <div className="font-semibold">Citation changed</div>
          {c.citationChanges.map((x, i) => (
            <div key={i}>
              <span className="font-medium">{x.label}:</span> <span className="line-through opacity-70">{x.from}</span> → <span className="italic">{x.to}</span>
            </div>
          ))}
        </div>
      )}
      {c.kind === "added" && c.after && <p className="mt-2 text-sm text-slate-700">{c.after.text}</p>}
      {c.kind === "removed" && c.before && <p className="mt-2 text-sm text-slate-500 line-through">{c.before.text}</p>}
    </li>
  );
}

function ExceptionRow({ e }: { e: ExceptionDiff }) {
  const k = KIND[e.kind];
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Pill tone={k.tone}>{k.label}</Pill>
        <span className="font-medium text-slate-900">{e.label}</span>
        <code className="rounded bg-slate-100 px-1 text-[11px] text-slate-500">{e.key}</code>
      </div>
      <p className="text-sm text-slate-700">{e.kind === "removed" ? e.beforeText : e.afterText}</p>
      <ChangeChips changes={e.changes} />
      {e.citationChanges.map((x, i) => (
        <div key={i} className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
          <span className="font-medium">{x.label}:</span> <span className="line-through opacity-70">{x.from}</span> → <span className="italic">{x.to}</span>
        </div>
      ))}
    </li>
  );
}

function Group({ title, changes }: { title: string; changes: ValueChange[] }) {
  if (changes.length === 0) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ChangeChips changes={changes} />
    </section>
  );
}

export function DiffView({ diff, showUnchanged = false }: { diff: VersionDiff; showUnchanged?: boolean }) {
  if (diff.identical) return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">v{diff.a.versionNumber} and v{diff.b.versionNumber} are identical.</p>;
  const criteria = diff.criteria.filter((c) => showUnchanged || c.kind !== "unchanged");
  const exceptions = diff.exceptions.filter((e) => showUnchanged || e.kind !== "unchanged");
  const hidden = diff.criteria.length - criteria.length;
  return (
    <div className="space-y-5">
      <Group title="Applicability" changes={diff.applicability} />
      {criteria.length > 0 && (
        <section>
          <SectionTitle>Criteria</SectionTitle>
          <ul className="space-y-2">{criteria.map((c) => <CriterionRow key={c.key} c={c} />)}</ul>
          {hidden > 0 && <p className="mt-2 text-xs text-slate-500">{hidden} unchanged criteri{hidden === 1 ? "on" : "a"} not shown.</p>}
        </section>
      )}
      {exceptions.length > 0 && (
        <section>
          <SectionTitle>Exceptions</SectionTitle>
          <ul className="space-y-2">{exceptions.map((e) => <ExceptionRow key={e.key} e={e} />)}</ul>
        </section>
      )}
      <Group title="Submission" changes={diff.submission} />
      <Group title="Source document" changes={diff.source} />
    </div>
  );
}

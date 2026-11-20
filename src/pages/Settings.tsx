import { useState } from "react";
import { ChevronDown, FileText, Lock } from "lucide-react";
import rad114 from "@fixtures/rules/RAD-114.json";
import { HANDOFF_MODES, OPERATIONS_MODULES, ROUTING_POLICY } from "@/data/settings";

type SectionId = "rules" | "handoff" | "operations";

const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "rules", label: "Rule library", blurb: "Insurer policies as structured rules" },
  { id: "handoff", label: "Handoff and routing", blurb: "What happens after a coordinator fix" },
  { id: "operations", label: "Operations", blurb: "Thresholds, SLAs, adapters, queues, models" },
];

export default function Settings() {
  const [section, setSection] = useState<SectionId>("rules");

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">
          Configuration that changes how orders are checked and routed. Versioned like rules; every order records the
          settings it ran under.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <Lock size={14} /> Read-only in this prototype. Values shown are the PRD's proposed defaults.
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-left transition ${
                section === s.id ? "bg-indigo-50" : "hover:bg-slate-100"
              }`}
            >
              <div className={`text-sm ${section === s.id ? "font-medium text-indigo-700" : "text-slate-800"}`}>
                {s.label}
              </div>
              <div className="text-xs text-slate-500">{s.blurb}</div>
            </button>
          ))}
        </nav>

        <div>
          {section === "rules" && <RuleLibrary />}
          {section === "handoff" && <Handoff />}
          {section === "operations" && <Operations />}
        </div>
      </div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white shadow-sm">{children}</div>;
}

function RuleLibrary() {
  const [open, setOpen] = useState(true);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Rules match on insurer, plan, CPT, setting, network and effective dates. The most specific rule wins. The AI
        extracts facts from documents; pass or fail is decided by the rule, so the same facts always give the same
        answer.
      </p>

      <Card>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <FileText size={18} className="shrink-0 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {rad114.match.insurer} · {rad114.policy}{" "}
              <span className="font-normal text-slate-500">v{rad114.version}</span>
            </div>
            <div className="text-xs text-slate-500">
              {rad114.title} · CPT {rad114.match.cpt.join(", ")} · {rad114.match.setting.join(", ")} · effective{" "}
              {rad114.effective}
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Published
          </span>
          <ChevronDown size={16} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="space-y-4 border-t border-slate-100 px-4 py-4 text-sm">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Criteria · all of
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {rad114.criteria.all.map((c) => (
                  <li key={c.id} className="flex gap-3 px-3 py-2.5">
                    <span className="w-7 shrink-0 font-mono text-xs font-semibold text-slate-500">{c.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-800">{c.policy_text}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                        <Tag>fact: {c.fact}</Tag>
                        {c.lookback_months && <Tag>lookback {c.lookback_months} mo</Tag>}
                        {c.sources && <Tag>sources: {c.sources.join(", ")}</Tag>}
                        {c.reject && <Tag tone="rose">rejects: {c.reject.join(", ")}</Tag>}
                        {c.exception && <Tag tone="sky">exception: symptoms materially changed</Tag>}
                        <Tag tone={c.fail_class === "clinical" ? "violet" : "amber"}>
                          {c.fail_class === "clinical" ? "failure is clinical" : "fixable by documents"}
                        </Tag>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Waivers</div>
              {rad114.waivers.map((w) => (
                <p key={w.section} className="text-slate-700">
                  §{w.section} red flags ({w.when.value.map((v) => v.replace(/_/g, " ")).join(", ")}) waive criteria{" "}
                  {w.waives.join(", ")}.
                </p>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 text-slate-700">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Submission</div>
                Channel: {rad114.submission.channel.toUpperCase()}. Attach:{" "}
                {rad114.submission.attachments.map((a) => a.replace(/_/g, " ")).join(", ")}. Denied requests{" "}
                {rad114.submission.amend_after_denial ? "can" : "cannot"} be amended.
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Source</div>
                {rad114.source.label}, page {rad114.source.page}
              </div>
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-400">
        Only RAD-114 is loaded (the rule behind test case 1). Publishing a new version will be blocked if a pinned test
        case changes result.
      </p>
    </div>
  );
}

function Tag({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "rose" | "sky" | "violet" | "amber" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-800",
  };
  return <span className={`rounded px-1.5 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}

function Handoff() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        When a coordinator resolves Awaiting documents or Needs correction, the order always goes back through
        Evaluating. The coordinator supplies the paper; the system decides. This setting controls what happens after a
        clean re-check.
      </p>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium">Modes</div>
        <ul className="divide-y divide-slate-100">
          {HANDOFF_MODES.map((m) => (
            <li key={m.id} className="px-4 py-3 text-sm">
              <div className="font-medium text-slate-900">{m.name}</div>
              <div className="mt-0.5 text-slate-600">After re-check: {m.after}</div>
              <div className="text-xs text-slate-500">Use when: {m.useWhen}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-medium">Routing policy</div>
          <div className="text-xs text-slate-500">One row per scope. Most specific wins.</div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-48 px-4 py-2 font-medium">Scope</th>
              <th className="px-4 py-2 font-medium">Example setting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ROUTING_POLICY.map((r) => (
              <tr key={r.scope}>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.scope}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-slate-400">
        An order that loops through Awaiting documents three times goes to a nurse automatically.
      </p>
    </div>
  );
}

function Operations() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Ten settings that differ by insurer, hospital or rollout stage. Making them configurable lets Halcyon turn
        automation up gradually without a release.
      </p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {OPERATIONS_MODULES.map((m) => (
          <Card key={m.id}>
            <div className="space-y-2 px-4 py-3 text-sm">
              <div className="font-medium text-slate-900">{m.name}</div>
              <p className="text-slate-600">{m.configurable}</p>
              <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                <span className="font-medium text-slate-500">Default · </span>
                {m.defaultValue}
              </div>
              <p className="text-xs text-slate-500">Why: {m.why}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

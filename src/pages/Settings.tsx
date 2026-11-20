import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import rad114 from "@fixtures/rules/RAD-114.json";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { PageTitle } from "@/components/ui/page-title";
import { PropertyList } from "@/components/ui/property-list";
import { StatusLabel } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import { HANDOFF_MODES, OPERATIONS_MODULES, ROUTING_POLICY } from "@/data/settings";
import { cn } from "@/lib/cn";
import { FAIL_CLASS_LABEL, RULE_LINE, RULE_SOURCE_LABEL, humanizeKey, label } from "@/lib/labels";

type SectionId = "rules" | "handoff" | "operations";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "rules", label: "Rule library" },
  { id: "handoff", label: "Handoff" },
  { id: "operations", label: "Operations" },
];

export default function Settings() {
  const [section, setSection] = useState<SectionId>("rules");

  return (
    <main className="mx-auto w-full max-w-page p-6">
      <div className="mb-6">
        <PageTitle readOnly>Settings</PageTitle>
      </div>

      <div className="grid grid-cols-settings gap-6">
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={cn(
                "h-8 rounded-md px-2 text-left text-body transition-colors",
                section === s.id ? "bg-hover font-medium text-accent-fg" : "text-label hover:bg-hover hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === "rules" && <RuleLibrary />}
          {section === "handoff" && <Handoff />}
          {section === "operations" && <Operations />}
        </div>
      </div>
    </main>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-panel">{children}</div>;
}

/** One-line row that expands to a detail block. */
function ExpandRow({ summary, trailing, children }: { summary: ReactNode; trailing?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex h-9 w-full items-center gap-2 px-3 text-left text-body hover:bg-hover"
      >
        <ChevronRight size={14} className={cn("shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
        {summary}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </button>
      {open && <div className="animate-collapsible px-4 pb-3 pl-8">{children}</div>}
    </div>
  );
}

const SHORT_TITLE: Record<string, string> = { "RAD-114": "Lumbar MRI" };
const dateLong = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function RuleLibrary() {
  const r = rad114;
  const effective = dateLong.format(new Date(`${r.effective}T12:00:00`));
  const cptList = r.match.cpt.join(", ");

  return (
    <Card>
      <div className="border-b border-line px-4 py-3">
        <div className="flex h-6 items-center gap-2">
          <span className="text-emph text-fg">
            {r.match.insurer} · {r.policy}
          </span>
          <span className="tabular text-body text-fg-2">v{r.version}</span>
          <span className="ml-auto">
            <StatusLabel tone="ready">Active</StatusLabel>
          </span>
        </div>
        <div className="text-caption text-fg-2">
          {SHORT_TITLE[r.policy] ?? r.title} ·{" "}
          <Tip content={`CPT ${cptList}`}>
            <span className="tabular">{r.match.cpt.length} CPT codes</span>
          </Tip>{" "}
          · Effective {effective}
        </div>
      </div>

      <div>
        {r.criteria.all.map((c) => {
          const accepts = c.sources?.map((s) => label(RULE_SOURCE_LABEL, s)).join(", ");
          const excludes = c.reject?.map((s) => label(RULE_SOURCE_LABEL, s)).join(", ");
          return (
            <ExpandRow
              key={c.id}
              summary={
                <>
                  <span className="tabular w-6 text-fg-2">{c.id}</span>
                  <span className="text-fg">{label(RULE_LINE, c.id)}</span>
                </>
              }
              trailing={
                <span className="text-caption text-fg-3 opacity-0 transition-opacity group-hover:opacity-100">
                  {label(FAIL_CLASS_LABEL, c.fail_class)}
                </span>
              }
            >
              <blockquote className="mb-2 text-body text-fg-2">“{c.policy_text}”</blockquote>
              <CollapsibleSection title="Details">
                <PropertyList
                  items={[
                    ...(accepts ? [{ label: "Accepts", value: accepts }] : []),
                    ...(excludes ? [{ label: "Excludes", value: excludes }] : []),
                    ...(c.lookback_months ? [{ label: "Lookback", value: `${c.lookback_months} mo` }] : []),
                    ...(c.exception ? [{ label: "Exception", value: "Symptoms materially changed" }] : []),
                    { label: "Failure", value: label(FAIL_CLASS_LABEL, c.fail_class) },
                  ]}
                />
              </CollapsibleSection>
            </ExpandRow>
          );
        })}

        {r.waivers.map((w) => (
          <ExpandRow
            key={w.section}
            summary={<span className="text-fg">Red flags waive {w.waives.join(", ")}</span>}
            trailing={<span className="text-caption text-fg-3">§{w.section}</span>}
          >
            <PropertyList items={[{ label: "Red flags", value: w.when.value.map(humanizeKey).join(", ") }]} />
          </ExpandRow>
        ))}

        <ExpandRow
          summary={
            <span className="text-fg">
              Submit via {r.submission.channel.toUpperCase()} · {r.submission.attachments.length} attachments
            </span>
          }
        >
          <PropertyList
            items={[
              { label: "Attach", value: r.submission.attachments.map(humanizeKey).join(", ") },
              { label: "After denial", value: r.submission.amend_after_denial ? "Can amend" : "Resubmit as new" },
              { label: "Source", value: `${r.source.label} · p.${r.source.page}` },
            ]}
          />
        </ExpandRow>
      </div>
    </Card>
  );
}

function Handoff() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-section text-fg">Modes</h2>
        <Card>
          {HANDOFF_MODES.map((m) => (
            <ExpandRow key={m.id} summary={<span className="text-fg">{m.name}</span>}>
              <PropertyList
                items={[
                  { label: "After re-check", value: m.after },
                  { label: "Use when", value: m.useWhen },
                ]}
              />
            </ExpandRow>
          ))}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-section text-fg">Routing</h2>
        <Card>
          {ROUTING_POLICY.map((r) => (
            <div key={r.scope} className="grid h-9 grid-cols-settings items-center gap-4 border-b border-line px-3 text-body last:border-b-0">
              <span className="text-fg-2">{r.scope}</span>
              <span className="truncate text-fg">{r.example}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function Operations() {
  return (
    <Card>
      {OPERATIONS_MODULES.map((m) => (
        <ExpandRow
          key={m.id}
          summary={<span className="text-fg">{m.name}</span>}
          trailing={<span className="truncate text-fg-2">{m.defaultValue}</span>}
        >
          <PropertyList
            items={[
              { label: "Configurable", value: m.configurable },
              { label: "Why", value: m.why },
            ]}
          />
        </ExpandRow>
      ))}
    </Card>
  );
}

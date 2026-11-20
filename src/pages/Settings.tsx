import { Link, useLocation } from "react-router-dom";
import { Card, ExpandRow } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { PropertyList } from "@/components/ui/property-list";
import { StaleChecks } from "@/components/operations/StaleChecks";
import { RuleLibrary } from "@/components/rule-library/RuleLibrary";
import { HANDOFF_MODES, OPERATIONS_MODULES, ROUTING_POLICY } from "@/data/settings";
import { cn } from "@/lib/cn";

type SectionId = "rules" | "handoff" | "operations";

const SECTIONS: { id: SectionId; label: string; to: string }[] = [
  { id: "rules", label: "Rule library", to: "/settings" },
  { id: "handoff", label: "Handoff", to: "/settings/handoff" },
  { id: "operations", label: "Operations", to: "/settings/operations" },
];

function sectionFromPath(pathname: string): SectionId {
  if (pathname.startsWith("/settings/handoff")) return "handoff";
  if (pathname.startsWith("/settings/operations")) return "operations";
  return "rules";
}

export default function Settings() {
  const { pathname } = useLocation();
  const section = sectionFromPath(pathname);

  return (
    <main className="mx-auto w-full max-w-page p-6">
      <div className="mb-6">
        <PageTitle readOnly>Settings</PageTitle>
      </div>

      <div className="grid grid-cols-settings gap-6">
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={s.to}
              aria-current={section === s.id ? "page" : undefined}
              className={cn(
                "flex h-8 items-center rounded-md px-2 text-left text-body transition-colors",
                section === s.id ? "bg-hover font-medium text-accent-fg" : "text-label hover:bg-hover hover:text-fg",
              )}
            >
              {s.label}
            </Link>
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
    <>
      <StaleChecks />
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
    </>
  );
}

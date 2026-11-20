import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { ChipInput, ChipSelect, Field, Switch, TextArea, TextInput } from "@/components/ui/form";
import { StatusDot } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import type { Criterion, PolicyException, ValidationIssue } from "@/domain/rules/types";
import { cn } from "@/lib/cn";
import { ProblemLine } from "./CriterionEditor";
import { humanizeKey } from "@/lib/labels";
import { issuesAt, triggerFromText, waiverPath } from "@/lib/ruleForm";

const first = (issues: ValidationIssue[], path: string) => issuesAt(issues, path)[0]?.message ?? null;

interface Props {
  waiver: PolicyException;
  /** This version's criteria, in order: the choices for "Waives". */
  criteria: Criterion[];
  issues: ValidationIssue[];
  defaultOpen: boolean;
  onChange: (patch: Partial<PolicyException>) => void;
  onDelete: () => void;
}

export function WaiverEditor({ waiver: w, criteria, issues, defaultOpen, onChange, onDelete }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const path = waiverPath(w);
  const mine = issuesAt(issues, path);
  const known = new Set(criteria.map((c) => c.key));
  // A waiver can point at a criterion that was since deleted. Keep it visible so it can be fixed.
  const options = [
    ...criteria.map((c) => ({ id: c.key, label: `${c.ref ? `${c.ref} ` : ""}${c.displayLabel || "Untitled"}` })),
    ...w.waivesCriterionKeys.filter((k) => !known.has(k)).map((k) => ({ id: k, label: "Deleted criterion" })),
  ];

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex h-9 items-center gap-2 pr-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-9 min-w-0 flex-1 items-center gap-2 pl-3 text-left text-body">
          <ChevronRight size={14} className={cn("shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
          {w.ref && <span className="tabular min-w-6 shrink-0 text-fg-2">{w.ref}</span>}
          <span className={cn("truncate", w.displayLabel ? "text-fg" : "text-fg-3")}>{w.displayLabel || "Untitled waiver"}</span>
          {w.assumption !== null && <StatusDot tone="hold" />}
          {mine.length > 0 && (
            <Tip content={`${mine.length} ${mine.length === 1 ? "problem" : "problems"} to fix before publishing`}>
              <span>
                <StatusDot tone="blocked" />
              </span>
            </Tip>
          )}
        </button>
        <Tip content="Delete waiver">
          <button
            type="button"
            aria-label={`Delete ${w.displayLabel || "waiver"}`}
            onClick={onDelete}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </Tip>
      </div>

      {!open && mine.length > 0 && <ProblemLine issues={mine} className="pl-8" />}

      {open && (
        <div className="animate-collapsible flex flex-col gap-3 pb-4 pl-8 pr-4">
          <div className="flex gap-3">
            <Field label="Label" error={first(issues, `${path}.displayLabel`)} className="flex-1">
              {(id) => <TextInput id={id} value={w.displayLabel} invalid={!!first(issues, `${path}.displayLabel`)} onChange={(e) => onChange({ displayLabel: e.target.value })} />}
            </Field>
            <Field label="Insurer ref" error={first(issues, `${path}.ref`)} className="w-40">
              {(id) => <TextInput id={id} value={w.ref} placeholder="e.g. 3" invalid={!!first(issues, `${path}.ref`)} onChange={(e) => onChange({ ref: e.target.value })} />}
            </Field>
          </div>

          <Field label="Triggers" error={first(issues, `${path}.triggers`)}>
            {() => (
              <ChipInput
                label="Triggers"
                value={w.triggers}
                placeholder="Type a trigger, then Enter"
                display={humanizeKey}
                normalize={triggerFromText}
                invalid={!!first(issues, `${path}.triggers`)}
                onChange={(triggers) => onChange({ triggers })}
              />
            )}
          </Field>

          <Field label="Waives" error={first(issues, `${path}.waivesCriterionKeys`)}>
            {() => (
              <ChipSelect
                label="Waives"
                value={w.waivesCriterionKeys}
                options={options}
                invalid={!!first(issues, `${path}.waivesCriterionKeys`)}
                onChange={(waivesCriterionKeys) => onChange({ waivesCriterionKeys })}
              />
            )}
          </Field>

          <Field label="Source text" error={first(issues, `${path}.excerpt`)}>
            {(id) => (
              <TextArea
                id={id}
                rows={2}
                value={w.excerpt}
                placeholder="Paste the insurer's exact words"
                invalid={!!first(issues, `${path}.excerpt`)}
                onChange={(e) => onChange({ excerpt: e.target.value })}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-body text-fg">
            <Switch checked={w.evaluationMode === "human_review"} onChange={(on) => onChange({ evaluationMode: on ? "human_review" : "auto" })} label="Clinician confirms" />
            Clinician confirms
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-body text-fg">
              <Switch checked={w.assumption !== null} onChange={(on) => onChange({ assumption: on ? "" : null })} label="Assumption" />
              Assumption
            </label>
            {w.assumption !== null && (
              <Field label="What was assumed" error={first(issues, `${path}.assumption`)}>
                {(id) => (
                  <TextArea
                    id={id}
                    rows={2}
                    value={w.assumption ?? ""}
                    placeholder="What was inferred, and why?"
                    invalid={!!first(issues, `${path}.assumption`)}
                    onChange={(e) => onChange({ assumption: e.target.value })}
                  />
                )}
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { ChevronRight, GripVertical, Trash2 } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Field, Segmented, Switch, TextArea, TextInput } from "@/components/ui/form";
import { StatusDot } from "@/components/ui/status-dot";
import { Tip } from "@/components/ui/tooltip";
import type { Criterion, FailureType, ValidationIssue } from "@/domain/rules/types";
import { cn } from "@/lib/cn";
import { FAILURE_TYPE_LABEL } from "@/lib/labels";
import { criterionPath, issuesAt } from "@/lib/ruleForm";
import { PropertiesEditor } from "./PropertyEditor";

const first = (issues: ValidationIssue[], path: string) => issuesAt(issues, path)[0]?.message ?? null;

export interface DragProps {
  dragging: boolean;
  over: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

interface Props {
  criterion: Criterion;
  /** Keys are locked once a version has been published; only criteria new to this draft may change theirs. */
  isNew: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  defaultOpen: boolean;
  drag: DragProps;
  onChange: (patch: Partial<Criterion>) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function CriterionEditor({ criterion: c, isNew, issues, warnings, defaultOpen, drag, onChange, onDelete, onMove }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const path = criterionPath(c);
  const mine = issuesAt(issues, path);
  const assumption = warnings.some((w) => w.path.startsWith(`${path}.`) && w.code === "assumption");

  const onHandleKey = (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn("border-b border-l-2 border-b-line last:border-b-0", drag.over ? "border-l-accent bg-hover" : "border-l-transparent", drag.dragging && "opacity-50")}
    >
      <div className="flex h-9 items-center gap-2 pl-1 pr-3">
        <Tip content="Drag to reorder. Alt + arrow keys also move it.">
          <button
            type="button"
            draggable
            aria-label={`Reorder ${c.displayLabel || "criterion"}`}
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
            onKeyDown={onHandleKey}
            className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          >
            <GripVertical size={14} />
          </button>
        </Tip>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-9 min-w-0 flex-1 items-center gap-2 text-left text-body">
          <ChevronRight size={14} className={cn("shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
          <span className="tabular min-w-6 shrink-0 text-fg-2">{c.ref}</span>
          <span className={cn("truncate", c.displayLabel ? "text-fg" : "text-fg-3")}>{c.displayLabel || "Untitled criterion"}</span>
          {assumption && <StatusDot tone="hold" />}
          {mine.length > 0 && (
            <Tip content={`${mine.length} ${mine.length === 1 ? "problem" : "problems"} to fix before publishing`}>
              <span>
                <StatusDot tone="blocked" />
              </span>
            </Tip>
          )}
        </button>
        <span className="shrink-0 text-caption text-fg-3">{FAILURE_TYPE_LABEL[c.failureType]}</span>
        <Tip content="Delete criterion">
          <button
            type="button"
            aria-label={`Delete ${c.displayLabel || "criterion"}`}
            onClick={onDelete}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </Tip>
      </div>

      {!open && mine.length > 0 && <ProblemLine issues={mine} className="pl-12" />}

      {open && (
        <div className="animate-collapsible flex flex-col gap-3 pb-4 pl-12 pr-4">
          <div className="flex gap-3">
            <Field label="Label" error={first(issues, `${path}.displayLabel`)} className="flex-1">
              {(id) => <TextInput id={id} value={c.displayLabel} invalid={!!first(issues, `${path}.displayLabel`)} onChange={(e) => onChange({ displayLabel: e.target.value })} />}
            </Field>
            <Field label="Insurer ref" error={first(issues, `${path}.ref`)} className="w-40">
              {(id) => <TextInput id={id} value={c.ref} placeholder="e.g. 2b or (2)" invalid={!!first(issues, `${path}.ref`)} onChange={(e) => onChange({ ref: e.target.value })} />}
            </Field>
          </div>

          <Field label="If it fails">
            {() => (
              <Segmented<FailureType>
                label="If it fails"
                value={c.failureType}
                options={[
                  { id: "clinical", label: FAILURE_TYPE_LABEL.clinical },
                  { id: "fixable", label: FAILURE_TYPE_LABEL.fixable },
                ]}
                onChange={(failureType) => onChange({ failureType })}
              />
            )}
          </Field>

          <Field label="Properties">
            {() => <PropertiesEditor properties={c.properties} basePath={path} issues={issues} onChange={(properties) => onChange({ properties })} />}
          </Field>

          <Field label="Source text" error={first(issues, `${path}.excerpt`)}>
            {(id) => (
              <TextArea
                id={id}
                rows={2}
                value={c.excerpt}
                placeholder="Paste the insurer's exact words"
                invalid={!!first(issues, `${path}.excerpt`)}
                onChange={(e) => onChange({ excerpt: e.target.value })}
              />
            )}
          </Field>

          <CollapsibleSection title="Advanced">
            <div className="flex flex-col gap-3 pb-1">
              <Field label="Key" error={first(issues, `${path}.key`)}>
                {(id) => (
                  <TextInput id={id} value={c.key} disabled={!isNew} invalid={!!first(issues, `${path}.key`)} onChange={(e) => onChange({ key: e.target.value })} className="max-w-xs font-mono" />
                )}
              </Field>
              <label className="flex items-center gap-2 text-body text-fg">
                <Switch checked={c.evaluationMode === "human_review"} onChange={(on) => onChange({ evaluationMode: on ? "human_review" : "auto" })} label="Clinician confirms" />
                Clinician confirms
              </label>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

/** What is wrong with a collapsed row, so a problem is never only a dot. */
export function ProblemLine({ issues, className }: { issues: ValidationIssue[]; className?: string }) {
  const more = issues.length - 1;
  return (
    <div className={cn("pb-2 pr-4 text-caption text-red-500", className)}>
      {issues[0].message}
      {more > 0 && ` (and ${more} more)`}
    </div>
  );
}

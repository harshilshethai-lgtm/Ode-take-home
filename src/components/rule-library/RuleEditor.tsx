// The editable card body: applicability, policy properties, criteria and waivers for one draft version.
// Everything the read-only card shows, as inputs. Saving is the parent's job (useDraftForm).

import { useRef, useState, type ReactNode } from "react";
import { AddButton, ChipInput, Field, TextInput } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import type { Criterion, PolicyException, ValidationResult, VersionEditableFields } from "@/domain/rules/types";
import { issuesAt, moveItem, newCriterion, newWaiver } from "@/lib/ruleForm";
import { CriterionEditor } from "./CriterionEditor";
import { PropertiesEditor } from "./PropertyEditor";
import { WaiverEditor } from "./WaiverEditor";

interface Props {
  versionId: string;
  form: VersionEditableFields;
  update: (change: Partial<VersionEditableFields> | ((f: VersionEditableFields) => Partial<VersionEditableFields>)) => void;
  validation: ValidationResult;
  /** Criterion keys inherited from the published version this draft was cloned from. Their keys are locked. */
  inheritedKeys: ReadonlySet<string>;
}

let localCounter = 0;
const localId = (prefix: string) => `${prefix}_new_${Date.now().toString(36)}${(localCounter++).toString(36)}`;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Card>
      <div className="flex h-9 items-center gap-2 border-b border-line px-3 text-body font-medium text-fg">
        {title}
        {count !== undefined && <span className="tabular font-normal text-fg-2">{count}</span>}
      </div>
      {children}
    </Card>
  );
}

export function RuleEditor({ versionId, form, update, validation, inheritedKeys }: Props) {
  const { errors, warnings } = validation;
  const fresh = useRef(new Set<string>());
  const startErrors = useRef<Set<string> | null>(null);
  startErrors.current ??= new Set(
    [...form.criteria, ...form.exceptions].filter((r) => issuesAt(errors, `${"properties" in r ? "criteria" : "exceptions"}.${r.key || r.id}`).length > 0).map((r) => r.id),
  );

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const setCriterion = (id: string, patch: Partial<Criterion>) =>
    update((f) => ({ criteria: f.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setWaiver = (id: string, patch: Partial<PolicyException>) =>
    update((f) => ({ exceptions: f.exceptions.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const move = (from: number, to: number) => update((f) => ({ criteria: moveItem(f.criteria, from, to) }));

  const addCriterion = () =>
    update((f) => {
      const c = newCriterion(versionId, f.criteria, () => localId("crit"));
      fresh.current.add(c.id);
      return { criteria: [...f.criteria, c] };
    });
  const addWaiver = () =>
    update((f) => {
      const w = newWaiver(versionId, f.exceptions, () => localId("exc"));
      fresh.current.add(w.id);
      return { exceptions: [...f.exceptions, w] };
    });

  const app = form.applicability;
  const setApp = (patch: Partial<typeof app>) => update({ applicability: { ...app, ...patch } });
  const msg = (path: string) => issuesAt(errors, path)[0]?.message ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Applies to">
        <div className="flex flex-col gap-3 p-4">
          <Field label="CPT codes" error={msg("applicability.cptCodes")}>
            {() => (
              <ChipInput
                label="CPT codes"
                value={app.cptCodes}
                placeholder="e.g. 72148"
                normalize={(raw) => raw.trim().toUpperCase()}
                invalid={!!msg("applicability.cptCodes")}
                onChange={(cptCodes) => setApp({ cptCodes })}
              />
            )}
          </Field>
          <div className="flex gap-3">
            <Field label="Effective from">
              {(id) => (
                <TextInput id={id} type="date" value={form.effectiveFrom ?? ""} className="w-40" onChange={(e) => update({ effectiveFrom: e.target.value || null })} />
              )}
            </Field>
            <Field label="Insurer revision" className="flex-1">
              {(id) => (
                <TextInput id={id} value={form.sourceRevisionLabel ?? ""} placeholder="e.g. Rev. 3" onChange={(e) => update({ sourceRevisionLabel: e.target.value || null })} />
              )}
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Policy properties" count={form.properties.length}>
        <div className="px-4 py-2">
          <PropertiesEditor policyLevel properties={form.properties} basePath="policy" issues={errors} onChange={(properties) => update({ properties })} />
        </div>
      </Section>

      <Section title="Criteria" count={form.criteria.length}>
        {form.criteria.length === 0 && <div className="px-4 py-3 text-body text-fg-2">No criteria yet.</div>}
        {msg("criteria") && form.criteria.length === 0 && <div className="px-4 pb-3 text-caption text-red-500">{msg("criteria")}</div>}
        {form.criteria.map((c, i) => (
          <CriterionEditor
            key={c.id}
            criterion={c}
            isNew={!inheritedKeys.has(c.key)}
            issues={errors}
            warnings={warnings}
            defaultOpen={fresh.current.has(c.id) || startErrors.current!.has(c.id)}
            drag={{
              dragging: dragFrom === i,
              over: dragOver === i && dragFrom !== null && dragFrom !== i,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.id);
                setDragFrom(i);
              },
              onDragEnd: () => {
                setDragFrom(null);
                setDragOver(null);
              },
              onDragOver: (e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              },
              onDrop: (e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              },
            }}
            onChange={(patch) => setCriterion(c.id, patch)}
            onDelete={() => update((f) => ({ criteria: f.criteria.filter((x) => x.id !== c.id) }))}
            onMove={(dir) => move(i, i + dir)}
          />
        ))}
        <div className="border-t border-line p-1">
          <AddButton onClick={addCriterion}>Add criterion</AddButton>
        </div>
      </Section>

      <Section title="Waivers" count={form.exceptions.length}>
        {form.exceptions.length === 0 && <div className="px-4 py-3 text-body text-fg-2">No waivers.</div>}
        {form.exceptions.map((w) => (
          <WaiverEditor
            key={w.id}
            waiver={w}
            criteria={form.criteria}
            issues={errors}
            defaultOpen={fresh.current.has(w.id) || startErrors.current!.has(w.id)}
            onChange={(patch) => setWaiver(w.id, patch)}
            onDelete={() => update((f) => ({ exceptions: f.exceptions.filter((x) => x.id !== w.id) }))}
          />
        ))}
        <div className="border-t border-line p-1">
          <AddButton onClick={addWaiver}>Add waiver</AddButton>
        </div>
      </Section>

    </div>
  );
}

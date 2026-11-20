// Editing properties: the same rows for a criterion's properties and for the policy's own. Each property is a
// label and a value; a check is optional, and a property without one is reviewed by a person.

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { AddButton, ChipInput, ChipSelect, Field, NumberInput, Segmented, SelectInput, Switch, TextInput } from "@/components/ui/form";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { POLICY_PROPERTY } from "@/domain/rules/policyProperties";
import type { CheckOp, Property, ValidationIssue } from "@/domain/rules/types";
import {
  CHECK_OPTIONS,
  FACT_OPTIONS,
  INCOMPLETE_OPTIONS,
  KNOWN_POLICY_PROPERTIES,
  VALUE_TYPE_OPTIONS,
  applyCheck,
  issuesAt,
  listOptionsFor,
  newProperty,
  propertyPath,
  valueTypeOf,
  type ValueType,
} from "@/lib/ruleForm";

interface Props {
  properties: Property[];
  /** Validation path of the owner: "criteria.conservative_care" or "policy". */
  basePath: string;
  issues: ValidationIssue[];
  onChange: (next: Property[]) => void;
  /** Offer the policy-level properties the app acts on (plan types, channels, ...). */
  policyLevel?: boolean;
}

export function PropertiesEditor({ properties, basePath, issues, onChange, policyLevel }: Props) {
  const set = (i: number, p: Property) => onChange(properties.map((x, j) => (j === i ? p : x)));
  return (
    <div className="flex flex-col">
      {properties.length === 0 && <div className="py-1 text-body text-fg-2">No properties yet.</div>}
      {properties.map((p, i) => (
        <PropertyRowEditor
          key={`${i}-${p.key}`}
          property={p}
          checkable={!policyLevel}
          issues={issuesAt(issues, propertyPath(basePath, p))}
          onChange={(next) => set(i, next)}
          onDelete={() => onChange(properties.filter((_, j) => j !== i))}
        />
      ))}
      <AddProperty existing={properties} policyLevel={policyLevel} onAdd={(p) => onChange([...properties, p])} />
    </div>
  );
}

interface RowProps {
  property: Property;
  /** Criterion properties can be checked against facts; policy properties describe the policy and are not. */
  checkable: boolean;
  issues: ValidationIssue[];
  onChange: (p: Property) => void;
  onDelete: () => void;
}

function PropertyRowEditor({ property: p, checkable, issues, onChange, onDelete }: RowProps) {
  const hasAssumption = p.assumption !== undefined;
  const error = issues[0]?.message ?? null;
  const setOp = (op: string) => onChange(applyCheck(p, (op || null) as CheckOp | null));

  return (
    <div data-property-editor={p.key} className="flex flex-col gap-2 border-t border-line py-2 first:border-t-0">
      <div className="flex items-start gap-2">
        <TextInput
          aria-label="Property name"
          value={p.label}
          placeholder="Name"
          className="w-40 shrink-0"
          onChange={(e) => onChange({ ...p, label: e.target.value })}
        />
        <div className="min-w-0 flex-1">
          <ValueControl property={p} invalid={!!error} onChange={onChange} />
        </div>
        <Tip content="Delete property">
          <button
            type="button"
            aria-label={`Delete ${p.label || "property"}`}
            onClick={onDelete}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </Tip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {checkable && (
          <>
            <SelectInput aria-label="Check" value={p.check?.op ?? ""} className="w-48" onChange={(e) => setOp(e.target.value)}>
              <option value="">No check</option>
              {CHECK_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
            {p.check ? (
              <SelectInput aria-label="Fact" value={p.check.fact} className="w-48" onChange={(e) => onChange(applyCheck(p, p.check!.op, e.target.value))}>
                {FACT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </SelectInput>
            ) : (
              <Chip>Not auto-checked</Chip>
            )}
          </>
        )}
        <label className="ml-auto flex items-center gap-2 text-body text-fg">
          <Switch
            checked={hasAssumption}
            onChange={(on) => {
              if (on) return onChange({ ...p, assumption: "" });
              const { assumption: _a, ...rest } = p;
              onChange(rest);
            }}
            label="Assumption"
          />
          Assumption
        </label>
      </div>
      {hasAssumption && (
        <TextInput
          aria-label="What was assumed"
          value={p.assumption}
          placeholder="What was inferred, and why?"
          invalid={!p.assumption?.trim()}
          onChange={(e) => onChange({ ...p, assumption: e.target.value })}
        />
      )}
      {error && <div className="text-caption text-red-500">{error}</div>}
    </div>
  );
}

function ValueControl({ property: p, invalid, onChange }: { property: Property; invalid: boolean; onChange: (p: Property) => void }) {
  const type = valueTypeOf(p);
  if (p.key === POLICY_PROPERTY.incompleteRequests) {
    return (
      <SelectInput aria-label={p.label} value={String(p.value)} onChange={(e) => onChange({ ...p, value: e.target.value })}>
        {INCOMPLETE_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectInput>
    );
  }
  if (type === "number") {
    return (
      <div className="flex items-center gap-2">
        <NumberInput aria-label={p.label || "Value"} value={p.value as number} invalid={invalid} onChange={(v) => onChange({ ...p, value: v ?? 0 })} />
        <TextInput
          aria-label="Unit"
          value={p.unit ?? ""}
          placeholder="Unit"
          className="w-24"
          onChange={(e) => onChange({ ...p, unit: e.target.value || undefined })}
        />
      </div>
    );
  }
  if (type === "boolean") {
    return (
      <label className="flex h-7 items-center gap-2 text-body text-fg">
        <Switch checked={p.value === true} onChange={(value) => onChange({ ...p, value })} label={p.label || "Value"} />
        {p.value ? "Yes" : "No"}
      </label>
    );
  }
  if (type === "list") {
    const options = listOptionsFor(p);
    const value = p.value as string[];
    return options ? (
      <ChipSelect label={p.label || "Value"} value={value} options={options} invalid={invalid} onChange={(v) => onChange({ ...p, value: v })} />
    ) : (
      <ChipInput label={p.label || "Value"} value={value} placeholder="Type, then Enter" invalid={invalid} onChange={(v) => onChange({ ...p, value: v })} />
    );
  }
  return (
    <TextInput
      aria-label={p.label || "Value"}
      value={String(p.value)}
      placeholder="Value"
      invalid={invalid}
      onChange={(e) => onChange({ ...p, value: e.target.value })}
    />
  );
}

/** "+ Add property": name it, pick a value type, and optionally what it checks. */
function AddProperty({ existing, policyLevel, onAdd }: { existing: Property[]; policyLevel?: boolean; onAdd: (p: Property) => void }) {
  const [label, setLabel] = useState("");
  const [valueType, setValueType] = useState<ValueType>("number");
  const [op, setOp] = useState<CheckOp | "">("");
  const [fact, setFact] = useState(FACT_OPTIONS[0].id);
  const known = policyLevel ? KNOWN_POLICY_PROPERTIES.filter((k) => !existing.some((p) => p.key === k.key)) : [];
  const reset = () => {
    setLabel("");
    setValueType("number");
    setOp("");
  };

  return (
    <Popover onOpenChange={(open) => !open && reset()}>
      <PopoverTrigger asChild>
        <AddButton className="self-start">Add property</AddButton>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3 p-3">
        {known.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-line pb-3">
            {known.map((k) => (
              <PopoverClose key={k.key} asChild>
                <Button variant="ghost" onClick={() => onAdd(structuredClone(k))}>
                  {k.label}
                </Button>
              </PopoverClose>
            ))}
          </div>
        )}
        <Field label="Name">{(id) => <TextInput id={id} value={label} placeholder="e.g. Lookback" onChange={(e) => setLabel(e.target.value)} />}</Field>
        <Field label="Value">{() => <Segmented<ValueType> label="Value type" value={valueType} options={VALUE_TYPE_OPTIONS} onChange={setValueType} />}</Field>
        {!policyLevel && (
          <Field label="Check (optional)">
            {(id) => (
              <SelectInput id={id} value={op} onChange={(e) => setOp(e.target.value as CheckOp | "")}>
                <option value="">No check</option>
                {CHECK_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}
        {op && (
          <Field label="Fact">
            {(id) => (
              <SelectInput id={id} value={fact} onChange={(e) => setFact(e.target.value)}>
                {FACT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}
        <PopoverClose asChild>
          <Button
            variant="default"
            disabled={!label.trim()}
            className="self-end"
            onClick={() => onAdd(newProperty({ label, valueType, op: op || null, fact: op ? fact : null }, existing))}
          >
            Add
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

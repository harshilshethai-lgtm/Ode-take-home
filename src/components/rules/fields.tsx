import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ZodType } from "zod";
import { SOURCE_LABEL, humanize } from "@/domain/rules/common";
import { schemaToFields, type FieldDef } from "@/domain/rules/schemaFields";

export const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50";

export function Field({ label, help, children, error }: { label: string; help?: string; children: ReactNode; error?: boolean }) {
  return (
    <label className="block">
      <span className={`mb-1 block text-xs font-medium ${error ? "text-rose-700" : "text-slate-700"}`}>{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  );
}

/** Type a value and press Enter (or comma) to add it as a chip. */
export function ChipInput({
  value,
  onChange,
  placeholder,
  format = (s) => s,
  normalize = (s) => s.trim(),
  ariaLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  format?: (s: string) => string;
  normalize?: (s: string) => string;
  ariaLabel: string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map(normalize).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
          {format(v)}
          <button type="button" aria-label={`Remove ${format(v)}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-slate-400 hover:text-rose-600">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        aria-label={ariaLabel}
        value={text}
        placeholder={value.length === 0 ? placeholder : "Add…"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && text === "" && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

export function CheckGroup({ options, value, onChange, labelFor }: { options: string[]; value: string[]; onChange: (v: string[]) => void; labelFor?: (o: string) => string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o} className="inline-flex items-center gap-1.5 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          {(labelFor ?? humanize)(o)}
        </label>
      ))}
    </div>
  );
}

const optionLabel = (o: string) => (o in SOURCE_LABEL ? SOURCE_LABEL[o as keyof typeof SOURCE_LABEL] : humanize(o));

/**
 * Renders the params form for any primitive straight from its Zod schema (labels and help come from `.meta()`).
 * Adding a primitive needs no change here.
 */
export function SchemaForm({
  schema,
  value,
  onChange,
  invalidFields = [],
}: {
  schema: ZodType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Field names that currently fail validation. */
  invalidFields?: string[];
}) {
  const fields = schemaToFields(schema);
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {fields.map((f) => (
        <div key={f.name} className={f.kind === "multiselect" || f.kind === "list" ? "md:col-span-2" : ""}>
          <SchemaField f={f} value={value[f.name]} onChange={(v) => set(f.name, v)} invalid={invalidFields.includes(f.name)} />
        </div>
      ))}
    </div>
  );
}

function SchemaField({ f, value, onChange, invalid }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; invalid: boolean }) {
  const label = f.optional ? `${f.label} (optional)` : f.label;
  const ring = invalid ? " border-rose-400" : "";
  switch (f.kind) {
    case "boolean":
      return (
        <div>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(f.optional && !e.target.checked ? undefined : e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            {f.label}
          </label>
          {f.help && <span className="mt-1 block text-xs text-slate-500">{f.help}</span>}
        </div>
      );
    case "number":
      return (
        <Field label={label} help={f.help} error={invalid}>
          <input
            type="number"
            min={0}
            step={f.integer ? 1 : "any"}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            className={inputCls + ring}
          />
        </Field>
      );
    case "select":
      return (
        <Field label={label} help={f.help} error={invalid}>
          <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputCls + ring}>
            {(f.optional || value === undefined) && <option value="">{f.optional ? "(none)" : "Choose…"}</option>}
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </Field>
      );
    case "multiselect":
      return (
        <div>
          <span className={`mb-1 block text-xs font-medium ${invalid ? "text-rose-700" : "text-slate-700"}`}>{label}</span>
          <CheckGroup options={f.options ?? []} value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => onChange(v.length ? v : undefined)} labelFor={optionLabel} />
          {f.help && <span className="mt-1 block text-xs text-slate-500">{f.help}</span>}
        </div>
      );
    case "list":
      return (
        <div>
          <span className={`mb-1 block text-xs font-medium ${invalid ? "text-rose-700" : "text-slate-700"}`}>{label}</span>
          <ChipInput ariaLabel={f.label} value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => onChange(v.length ? v : undefined)} format={humanize} normalize={(s) => s.trim().toLowerCase().replace(/\s+/g, "_")} placeholder="Type and press Enter" />
          {f.help && <span className="mt-1 block text-xs text-slate-500">{f.help}</span>}
        </div>
      );
    default:
      return (
        <Field label={label} help={f.help} error={invalid}>
          <input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputCls + ring} />
        </Field>
      );
  }
}

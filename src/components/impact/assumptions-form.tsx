import { useState } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Chip } from "@/components/ui/chip";
import {
  ASSUMPTION_FIELDS,
  INPUT_SOURCE_LABEL,
  type Assumptions,
} from "@/data/impact/metrics";

export function AssumptionsForm({
  value,
  onChange,
}: {
  value: Assumptions;
  onChange: (next: Assumptions) => void;
}) {
  return (
    <CollapsibleSection title="Assumptions">
      <div className="mt-2 rounded-lg border border-line bg-panel">
        {ASSUMPTION_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <span className="text-body text-fg">{field.label}</span>
            <Chip>{INPUT_SOURCE_LABEL[field.source]}</Chip>
            <span className="ml-auto inline-flex items-center gap-1">
              {field.prefix && <span className="text-caption text-fg-3">{field.prefix}</span>}
              <NumberField
                label={field.label}
                value={value[field.key]}
                onChange={(next) => onChange({ ...value, [field.key]: next })}
              />
            </span>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder="Not set"
      onChange={(event) => {
        const next = event.target.value;
        if (next !== "" && !/^\d*\.?\d{0,2}$/.test(next)) return;
        setText(next);
        if (next === "" || next === ".") onChange(null);
        else onChange(Number(next));
      }}
      className="h-7 w-24 rounded-md border border-line bg-panel px-2 text-right text-body text-fg tabular outline-none placeholder:text-fg-3"
    />
  );
}

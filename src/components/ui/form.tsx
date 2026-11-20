// Form controls for the rule editor. Same tokens as the rest of the app: 28px controls, hairline borders,
// indigo focus ring, red only for errors.

import { Check, Plus, X } from "lucide-react";
import { useId, useState, type ComponentProps, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-md border border-line bg-panel px-2 text-body text-fg outline-none placeholder:text-fg-3 focus-visible:border-accent disabled:opacity-50";

export function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-caption text-fg-2">
        {label}
      </label>
      {children(id)}
      {error && <span className="text-caption text-red-500">{error}</span>}
    </div>
  );
}

export function TextInput({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input type="text" aria-invalid={invalid || undefined} className={cn(control, "h-7", invalid && "border-red-500", className)} {...props} />;
}

export function TextArea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea rows={3} aria-invalid={invalid || undefined} className={cn(control, "resize-y py-1", invalid && "border-red-500", className)} {...props} />;
}

/** Whole numbers. Empty input means "not set" (undefined). */
export function NumberInput({
  value,
  onChange,
  invalid,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  invalid?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={value ?? ""}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? undefined : Math.trunc(Number(raw)));
      }}
      className={cn(control, "tabular h-7 w-24", invalid && "border-red-500")}
      {...props}
    />
  );
}

export function SelectInput({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-7", className)} {...props}>
      {children}
    </select>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-8 shrink-0 rounded-md border border-line transition-colors", checked ? "bg-accent" : "bg-chip")}
    >
      <span className={cn("absolute top-1 size-3 rounded-md bg-panel transition-all", checked ? "left-4" : "left-1")} />
    </button>
  );
}

/** Two or three mutually exclusive choices. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 self-start rounded-md border border-line bg-panel p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-2 text-body transition-colors",
            o.id === value ? "bg-chip font-medium text-fg" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const chipBase = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-2 text-caption";

/** Pick any number of fixed options. Values outside `options` (older data) stay visible and removable. */
export function ChipSelect({
  value,
  options,
  onChange,
  label,
  invalid,
}: {
  value: string[];
  options: Array<{ id: string; label: string }>;
  onChange: (v: string[]) => void;
  label: string;
  invalid?: boolean;
}) {
  const known = new Set(options.map((o) => o.id));
  const all = [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ id: v, label: v }))];
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1", invalid && "rounded-md ring-1 ring-red-500")}>
      {all.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={cn(chipBase, on ? "bg-chip text-fg" : "border border-line text-fg-3 hover:text-fg")}
          >
            {on && <Check size={12} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Free-text chips: type, then Enter or comma. Backspace on an empty box removes the last one. */
export function ChipInput({
  value,
  onChange,
  label,
  placeholder,
  display = (v) => v,
  normalize = (v) => v.trim(),
  invalid,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
  placeholder?: string;
  display?: (v: string) => string;
  normalize?: (raw: string) => string;
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(",").map(normalize).filter(Boolean);
    setText("");
    if (parts.length === 0) return;
    onChange([...value, ...parts.filter((p, i) => !value.includes(p) && parts.indexOf(p) === i)]);
  };
  return (
    <div
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-1 rounded-md border border-line bg-panel p-1 focus-within:border-accent",
        invalid && "border-red-500",
      )}
    >
      {value.map((v) => (
        <span key={v} className={cn(chipBase, "bg-chip text-fg")}>
          {display(v)}
          <button type="button" aria-label={`Remove ${display(v)}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-fg-3 hover:text-fg">
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        placeholder={value.length === 0 ? placeholder : "Add"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && text === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        className="h-5 min-w-16 flex-1 bg-transparent px-1 text-body text-fg outline-none placeholder:text-fg-3"
      />
    </div>
  );
}

/** Small "+ Add …" text button used at the bottom of a list. */
export function AddButton({ children, className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-body text-accent-fg hover:bg-hover", className)}
      {...props}
    >
      <Plus size={14} />
      {children}
    </button>
  );
}

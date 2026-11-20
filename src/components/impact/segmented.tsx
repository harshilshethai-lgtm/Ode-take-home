import { cn } from "@/lib/cn";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 overflow-hidden rounded-md border border-line">
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const dir = event.key === "ArrowRight" ? 1 : -1;
              const next = (index + dir + options.length) % options.length;
              onChange(options[next].id);
              const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
              buttons?.[next]?.focus();
            }}
            className={cn(
              "h-full px-2 text-body",
              selected ? "bg-hover font-semibold text-fg" : "text-fg-2 hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

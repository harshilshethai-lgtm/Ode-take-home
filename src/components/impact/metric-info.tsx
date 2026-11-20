import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { CONCEPTS, DIRECTION_LABEL, SOURCE_LABEL, type MetricSpec } from "@/data/impact/metrics";
import { baselineCopy } from "@/domain/impact/format";
import { Chip } from "@/components/ui/chip";

/** Circled info control. Opens on hover and keyboard focus; Esc or blur closes it. */
export function InfoButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
        >
          <Info size={14} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-72 rounded-md border border-line bg-panel p-3 text-caption text-fg shadow-sm"
        >
          {children}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function MetricInfo({ metric, baseline }: { metric: MetricSpec; baseline: number | null }) {
  return (
    <InfoButton label={`About ${metric.name}`}>
      <div className="flex flex-col gap-2">
        <Field label="Definition" text={metric.definition} />
        <Field label="Formula" text={metric.formula} />
        <Field label="Baseline" text={baselineCopy(metric, baseline)} tag={SOURCE_LABEL[metric.baselineSource]} />
        <Field label="Target" text={metric.targetDetail} />
        <Field label="Direction" text={DIRECTION_LABEL[metric.direction]} />
        <Field label="Why it matters" text={metric.whyItMatters} />
      </div>
    </InfoButton>
  );
}

export function ConceptInfo({ id }: { id: keyof typeof CONCEPTS }) {
  const concept = CONCEPTS[id];
  return (
    <InfoButton label={`About ${concept.name}`}>
      <Field label="Definition" text={concept.definition} />
    </InfoButton>
  );
}

function Field({ label, text, tag }: { label: string; text: string; tag?: string }) {
  return (
    <div>
      <div className="text-fg-3">{label}</div>
      <div>{text}</div>
      {tag && (
        <div className="mt-1">
          <Chip>{tag}</Chip>
        </div>
      )}
    </div>
  );
}

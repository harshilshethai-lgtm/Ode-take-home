import { z } from "zod";
import {
  SOURCE_LABEL,
  SOURCE_LABEL_PLURAL,
  factRef,
  factsOfType,
  humanize,
  joinList,
  plural,
  sourceBlurb,
  asRecord,
  uniq,
} from "../common";
import { addMonths, daysBetween } from "../dates";
import { SOURCE_TYPES, type Fact, type Primitive } from "../types";

const paramsSchema = z.object({
  factType: z
    .string()
    .min(1)
    .meta({ title: "Fact type", description: "Which kind of fact to look for, e.g. conservative_treatment." }),
  minWeeks: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ title: "Minimum weeks", description: "Total weeks of evidence needed. Overlapping treatments are not double-counted." }),
  lookbackMonths: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ title: "Lookback (months)", description: "Only count evidence from this many months before the service date." }),
  allowedSourceTypes: z
    .array(z.enum(SOURCE_TYPES))
    .min(1)
    .meta({ title: "Accepted sources", description: "Evidence from any other source type is ignored." }),
  allowedModalities: z
    .array(z.string().min(1))
    .optional()
    .meta({
      title: "Accepted treatment types",
      description: "e.g. physical_therapy, chiropractic, prescription_medication. Leave empty to accept any.",
    }),
  requireResponseDocumented: z
    .boolean()
    .optional()
    .meta({ title: "Patient's response must be documented", description: "At least one qualifying record must describe the response." }),
});
type Params = z.infer<typeof paramsSchema>;

interface Interval {
  start: string;
  end: string;
}

/** Fact convention: value = { modality, startDate?, endDate?, responseDocumented? }; `date` = last day of the treatment. */
function intervalOf(f: Fact): Interval {
  const v = asRecord(f.value);
  const end = typeof v.endDate === "string" ? v.endDate : f.date;
  const start = typeof v.startDate === "string" ? v.startDate : end;
  return { start, end };
}

/** Days covered by the union of intervals, so concurrent treatments aren't added together. */
function coveredDays(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
  let total = 0;
  let cur: Interval | null = null;
  for (const iv of sorted) {
    if (cur && iv.start <= cur.end) {
      if (iv.end > cur.end) cur = { start: cur.start, end: iv.end };
    } else {
      if (cur) total += daysBetween(cur.start, cur.end);
      cur = { ...iv };
    }
  }
  if (cur) total += daysBetween(cur.start, cur.end);
  return total;
}

function modalityOf(f: Fact): string {
  const m = asRecord(f.value).modality;
  return typeof m === "string" ? m : "treatment";
}

export const evidenceInWindow: Primitive<Params> = {
  type: "evidence_in_window",
  label: "Documented evidence in a time window",
  summary: "Enough weeks of documented evidence (e.g. conservative treatment) from accepted sources, within a lookback window.",
  paramsSchema,
  defaultParams: {
    factType: "conservative_treatment",
    minWeeks: 6,
    lookbackMonths: 6,
    allowedSourceTypes: ["pt_note", "clinic_note_treating_provider"],
    requireResponseDocumented: true,
  },
  describe(p) {
    const what = p.factType === "conservative_treatment" ? "conservative treatment" : humanize(p.factType);
    const head = p.minWeeks ? `At least ${plural(p.minWeeks, "week")} of ${what}` : `Documented ${what}`;
    const mods = p.allowedModalities?.length
      ? ` (${joinList(p.allowedModalities.map(humanize))})`
      : "";
    const window = p.lookbackMonths ? ` in the past ${plural(p.lookbackMonths, "month")}` : "";
    const sources = `, documented in ${joinList(p.allowedSourceTypes.map((s) => SOURCE_LABEL_PLURAL[s]))}`;
    const response = p.requireResponseDocumented ? ", including the patient's response" : "";
    return `${head}${mods}${window}${sources}${response}.`;
  },
  evaluate(p, facts, ctx) {
    const what = p.factType === "conservative_treatment" ? "conservative treatment" : humanize(p.factType);
    const all = factsOfType(facts, p.factType);
    if (all.length === 0) {
      return { status: "unknown", detail: `No documentation found for ${what}.`, evidenceRefs: [] };
    }

    const accepted = all.filter((f) => p.allowedSourceTypes.includes(f.sourceType));
    const rejected = all.filter((f) => !p.allowedSourceTypes.includes(f.sourceType));
    if (accepted.length === 0) {
      const labels = uniq(rejected.map((f) => SOURCE_LABEL[f.sourceType]));
      const article = labels.length === 1 && /^[aeiou]/.test(labels[0]) ? "an" : "a";
      const kind = labels.length === 1 ? `${article} ${labels[0]} source` : `these sources (${joinList(labels, "and")})`;
      return {
        status: "not_met",
        detail: `Found only in ${kind}, which this policy does not accept.`,
        evidenceRefs: rejected.map(factRef),
      };
    }
    const ignoredNote = rejected.length ? " Records from sources this policy does not accept were ignored." : "";

    const modalityFilter = p.allowedModalities?.length ? p.allowedModalities : null;
    const byModality = modalityFilter ? accepted.filter((f) => modalityFilter.includes(modalityOf(f))) : accepted;
    if (byModality.length === 0) {
      return {
        status: "not_met",
        detail: `Found ${joinList(uniq(accepted.map((f) => humanize(modalityOf(f)))), "and")}, but this policy accepts only ${joinList((modalityFilter ?? []).map(humanize))}.${ignoredNote}`,
        evidenceRefs: accepted.map(factRef),
      };
    }

    const windowStart = p.lookbackMonths ? addMonths(ctx.serviceDate, -p.lookbackMonths) : null;
    const inWindow = windowStart ? byModality.filter((f) => intervalOf(f).end >= windowStart) : byModality;
    if (inWindow.length === 0) {
      return {
        status: "not_met",
        detail: `Found ${what} (${byModality.map(sourceBlurb).join("; ")}), but none within the past ${plural(p.lookbackMonths ?? 0, "month")}.${ignoredNote}`,
        evidenceRefs: byModality.map(factRef),
      };
    }

    const clipped = inWindow.map((f) => {
      const iv = intervalOf(f);
      return { start: windowStart && iv.start < windowStart ? windowStart : iv.start, end: iv.end };
    });
    const weeks = Math.floor(coveredDays(clipped) / 7);
    const modalities = joinList(uniq(inWindow.map((f) => humanize(modalityOf(f)))), "and");
    const sources = uniq(inWindow.map(sourceBlurb)).join("; ");
    const requirement = p.minWeeks
      ? `policy requires at least ${plural(p.minWeeks, "week")}${p.lookbackMonths ? ` within the past ${plural(p.lookbackMonths, "month")}` : ""}`
      : "policy requires documentation";
    const refs = inWindow.map(factRef);

    if (p.minWeeks && weeks < p.minWeeks) {
      return {
        status: "not_met",
        detail: `Found ${plural(weeks, "week")} of ${modalities} (${sources}); ${requirement}.${ignoredNote}`,
        evidenceRefs: refs,
      };
    }
    if (p.requireResponseDocumented && !inWindow.some((f) => asRecord(f.value).responseDocumented === true)) {
      return {
        status: "unknown",
        detail: `Found ${plural(weeks, "week")} of ${modalities} (${sources}), but the patient's response to treatment is not documented.${ignoredNote}`,
        evidenceRefs: refs,
      };
    }
    return {
      status: "met",
      detail: `Found ${plural(weeks, "week")} of ${modalities} (${sources}); ${requirement}.${ignoredNote}`,
      evidenceRefs: refs,
    };
  },
};

import { z } from "zod";
import { factRef, factsOfType, humanize, plural, sourceBlurb, capitalize } from "../common";
import { weeksBetween } from "../dates";
import type { Primitive } from "../types";

const paramsSchema = z.object({
  factType: z
    .string()
    .min(1)
    .meta({ title: "Fact type", description: "Which kind of fact holds the start date, e.g. symptom_onset." }),
  minWeeks: z
    .number()
    .int()
    .positive()
    .meta({ title: "Minimum weeks", description: "Whole weeks between the fact's date and the service date." }),
});
type Params = z.infer<typeof paramsSchema>;

/** Fact convention: `type` = factType, `date` = the day the condition started. The earliest such fact wins. */
export const minDuration: Primitive<Params> = {
  type: "min_duration",
  label: "Minimum duration",
  summary: "A condition must have been present for at least N weeks.",
  paramsSchema,
  defaultParams: { factType: "symptom_onset", minWeeks: 6 },
  describe: ({ factType, minWeeks }) =>
    factType === "symptom_onset"
      ? `Symptoms present for at least ${plural(minWeeks, "week")}.`
      : `${capitalize(humanize(factType))} at least ${plural(minWeeks, "week")} ago.`,
  evaluate({ factType, minWeeks }, facts, ctx) {
    const label = factType === "symptom_onset" ? "symptom onset" : humanize(factType);
    const found = factsOfType(facts, factType).sort((a, b) => a.date.localeCompare(b.date));
    if (found.length === 0) {
      return { status: "unknown", detail: `No documentation found for ${label}.`, evidenceRefs: [] };
    }
    const earliest = found[0];
    const weeks = weeksBetween(earliest.date, ctx.serviceDate);
    const detail = `Found ${label} dated ${earliest.date} (${plural(weeks, "week")} before the service date, ${sourceBlurb(earliest)}); policy requires at least ${plural(minWeeks, "week")}.`;
    return { status: weeks >= minWeeks ? "met" : "not_met", detail, evidenceRefs: [factRef(earliest)] };
  },
};

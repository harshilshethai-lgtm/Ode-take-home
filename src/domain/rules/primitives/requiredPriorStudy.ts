import { z } from "zod";
import { bodySiteLabel, factRef, plural, sourceBlurb, studyLabel, capitalize } from "../common";
import { addMonths } from "../dates";
import type { Fact, Primitive } from "../types";
import { imagingStudies, sideMatch, STUDY_TYPES } from "./studies";

const paramsSchema = z.object({
  studyType: z.enum(STUDY_TYPES).meta({ title: "Study type", description: "The prior study that must exist." }),
  bodySite: z.string().min(1).meta({ title: "Body site", description: "e.g. lumbar_spine, knee, shoulder." }),
  withinMonths: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ title: "Within (months)", description: "Leave empty if the policy sets no recency." }),
  sameLaterality: z
    .boolean()
    .optional()
    .meta({ title: "Same side as the order", description: "Require the study to be of the same left/right side." }),
});
type Params = z.infer<typeof paramsSchema>;

export const requiredPriorStudy: Primitive<Params> = {
  type: "required_prior_study",
  label: "Required prior study",
  summary: "A prior imaging study (e.g. X-ray) must be on record, optionally recent and of the same side.",
  paramsSchema,
  defaultParams: { studyType: "xray", bodySite: "knee", withinMonths: 6 },
  describe: (p) =>
    `${capitalize(studyLabel(p.studyType))} of the ${bodySiteLabel(p.bodySite)}${p.sameLaterality ? " (same side as the order)" : ""}${p.withinMonths ? ` within the past ${plural(p.withinMonths, "month")}` : ""}.`,
  evaluate(p, facts, ctx) {
    const label = `${studyLabel(p.studyType)} of the ${bodySiteLabel(p.bodySite)}`;
    const studies = imagingStudies(facts, p.studyType, p.bodySite);
    if (studies.length === 0) {
      return { status: "unknown", detail: `No documentation found for ${label}.`, evidenceRefs: [] };
    }

    let usable: Fact[] = studies;
    if (p.sameLaterality) {
      const sides = studies.map((s) => ({ s, m: sideMatch(s.laterality, ctx.laterality) }));
      usable = sides.filter((x) => x.m === "match").map((x) => x.s);
      if (usable.length === 0) {
        const unclear = sides.filter((x) => x.m === "unknown");
        if (unclear.length > 0) {
          return {
            status: "unknown",
            detail: `Found ${label} (${unclear.map((x) => sourceBlurb(x.s)).join("; ")}), but the side is not documented on the study or the order, so it cannot be matched to the same side.`,
            evidenceRefs: unclear.map((x) => factRef(x.s)),
          };
        }
        return {
          status: "not_met",
          detail: `Found ${label} (${studies.map(sourceBlurb).join("; ")}), but only of the opposite side; policy requires the same side as the order.`,
          evidenceRefs: studies.map(factRef),
        };
      }
    }

    const windowStart = p.withinMonths ? addMonths(ctx.serviceDate, -p.withinMonths) : null;
    const recent = windowStart ? usable.filter((f) => f.date >= windowStart) : usable;
    if (recent.length === 0) {
      const latest = [...usable].sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        status: "not_met",
        detail: `Found ${label} dated ${latest.date} (${sourceBlurb(latest)}), which is older than the past ${plural(p.withinMonths ?? 0, "month")}; policy requires a more recent study.`,
        evidenceRefs: [factRef(latest)],
      };
    }
    const latest = [...recent].sort((a, b) => b.date.localeCompare(a.date))[0];
    return {
      status: "met",
      detail: `Found ${label} dated ${latest.date} (${sourceBlurb(latest)})${p.withinMonths ? `, within the past ${plural(p.withinMonths, "month")}` : ""}.`,
      evidenceRefs: [factRef(latest)],
    };
  },
};

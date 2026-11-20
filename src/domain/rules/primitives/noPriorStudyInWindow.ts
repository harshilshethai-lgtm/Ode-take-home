import { z } from "zod";
import { bodySiteLabel, factRef, humanize, plural, sourceBlurb, studyLabel } from "../common";
import { addMonths } from "../dates";
import type { Fact, Primitive } from "../types";
import { imagingStudies, sideMatch, STUDY_TYPES } from "./studies";

const paramsSchema = z.object({
  studyType: z.enum(STUDY_TYPES).meta({ title: "Study type", description: "The repeat study that is not allowed." }),
  bodySite: z.string().min(1).meta({ title: "Body site", description: "e.g. lumbar_spine, knee, shoulder." }),
  withinMonths: z.number().int().positive().meta({ title: "Within (months)", description: "No such study may exist in this window." }),
  sameLaterality: z
    .boolean()
    .meta({ title: "Same side only", description: "If on, only a study of the same left/right side counts as a repeat." }),
  overrideCondition: z
    .string()
    .min(1)
    .optional()
    .meta({
      title: "Override condition",
      description:
        "A fact type (e.g. symptoms_materially_changed). If it is documented, a repeat study is sent to a clinician instead of failing.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * A negative criterion. Silence is not proof: "no prior MRI" is only `met` when the imaging history was reviewed
 * (a fact of type "imaging_history_reviewed"). Otherwise the result is `unknown`.
 */
export const noPriorStudyInWindow: Primitive<Params> = {
  type: "no_prior_study_in_window",
  label: "No repeat imaging in window",
  summary: "The same kind of study must not have been done recently (optionally unless symptoms changed).",
  paramsSchema,
  defaultParams: { studyType: "mri", bodySite: "knee", withinMonths: 12, sameLaterality: true },
  describe(p) {
    const base = `No ${bodySiteLabel(p.bodySite)} ${studyLabel(p.studyType)}${p.sameLaterality ? ` of the same ${p.bodySite === "knee" ? "knee" : "side"}` : ""} in the past ${plural(p.withinMonths, "month")}.`;
    return p.overrideCondition
      ? `${base} If ${humanize(p.overrideCondition)}, a clinician reviews.`
      : base;
  },
  evaluate(p, facts, ctx) {
    const label = `${bodySiteLabel(p.bodySite)} ${studyLabel(p.studyType)}`;
    const windowStart = addMonths(ctx.serviceDate, -p.withinMonths);
    const inWindow = imagingStudies(facts, p.studyType, p.bodySite).filter((f) => f.date >= windowStart);

    const definite: Fact[] = [];
    const uncertain: Fact[] = [];
    for (const f of inWindow) {
      const m = p.sameLaterality ? sideMatch(f.laterality, ctx.laterality) : "match";
      if (m === "match") definite.push(f);
      else if (m === "unknown") uncertain.push(f);
    }

    if (definite.length > 0) {
      const latest = [...definite].sort((a, b) => b.date.localeCompare(a.date))[0];
      const overridden = p.overrideCondition
        ? facts.find((f) => f.type === p.overrideCondition && f.value === true)
        : undefined;
      if (overridden) {
        return {
          status: "needs_review",
          detail: `Found ${label} dated ${latest.date} (${sourceBlurb(latest)}) within the past ${plural(p.withinMonths, "month")}, but the record says ${humanize(p.overrideCondition!)}; a clinician must confirm a repeat study is justified.`,
          evidenceRefs: [factRef(latest), factRef(overridden)],
        };
      }
      return {
        status: "not_met",
        detail: `Found ${label} dated ${latest.date} (${sourceBlurb(latest)}) within the past ${plural(p.withinMonths, "month")}; policy allows none.`,
        evidenceRefs: [factRef(latest)],
      };
    }
    if (uncertain.length > 0) {
      return {
        status: "needs_review",
        detail: `Found ${label} within the past ${plural(p.withinMonths, "month")} (${uncertain.map(sourceBlurb).join("; ")}), but the side is not documented, so it cannot be ruled out as the same side.`,
        evidenceRefs: uncertain.map(factRef),
      };
    }

    const reviewed = facts.find((f) => f.type === "imaging_history_reviewed");
    if (!reviewed) {
      return {
        status: "unknown",
        detail: `No documentation found for imaging history, so a prior ${label} cannot be ruled out.`,
        evidenceRefs: [],
      };
    }
    return {
      status: "met",
      detail: `Imaging history reviewed (${sourceBlurb(reviewed)}) and no ${label} found in the past ${plural(p.withinMonths, "month")}.`,
      evidenceRefs: [factRef(reviewed)],
    };
  },
};

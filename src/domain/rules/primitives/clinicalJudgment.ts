import { z } from "zod";
import type { Primitive } from "../types";

const paramsSchema = z.object({
  question: z
    .string()
    .min(1)
    .meta({ title: "Question for the clinician", description: "Phrase it as a question a nurse can answer yes or no." }),
});
type Params = z.infer<typeof paramsSchema>;

export const clinicalJudgment: Primitive<Params> = {
  type: "clinical_judgment",
  label: "Clinical judgment",
  summary: "Cannot be decided from facts. Always goes to a clinician with a specific question.",
  paramsSchema,
  defaultParams: { question: "" },
  describe: (p) => `A clinician must confirm: ${p.question}`,
  evaluate: (p) => ({
    status: "needs_review",
    detail: `A clinician must answer: ${p.question}`,
    evidenceRefs: [],
  }),
};

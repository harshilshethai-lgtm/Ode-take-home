import { z } from "zod";
import { asRecord, factRef, humanize, joinList, plural } from "../common";
import { daysBetween } from "../dates";
import type { Fact, Primitive } from "../types";

const paramsSchema = z.object({
  documentTypes: z
    .array(z.string().min(1))
    .min(1)
    .meta({ title: "Documents", description: "Document types that must be attached, e.g. office_note." }),
  recencyDays: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ title: "Recency (days)", description: "Each document must be dated within this many days of the service date." }),
});
type Params = z.infer<typeof paramsSchema>;

/** Fact convention: type "document", value { documentType }, date = document date. */
export const requiredDocumentation: Primitive<Params> = {
  type: "required_documentation",
  label: "Required documentation",
  summary: "Specific documents (e.g. the most recent office note) must be on file.",
  paramsSchema,
  defaultParams: { documentTypes: ["office_note"] },
  describe: (p) =>
    `Most recent ${joinList(p.documentTypes.map(humanize), "and")} attached${p.recencyDays ? `, dated within the past ${plural(p.recencyDays, "day")}` : ""}.`,
  evaluate(p, facts, ctx) {
    const docs = facts.filter((f) => f.type === "document");
    const problems: string[] = [];
    const refs: Fact[] = [];
    for (const t of p.documentTypes) {
      const matching = docs
        .filter((d) => asRecord(d.value).documentType === t)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (matching.length === 0) {
        problems.push(`no ${humanize(t)} found`);
        continue;
      }
      refs.push(matching[0]);
      if (p.recencyDays && daysBetween(matching[0].date, ctx.serviceDate) > p.recencyDays) {
        problems.push(`the most recent ${humanize(t)} is dated ${matching[0].date}, older than ${plural(p.recencyDays, "day")}`);
      }
    }
    if (problems.length > 0) {
      return {
        status: "unknown",
        detail: `No documentation found for the required attachments: ${problems.join("; ")}.`,
        evidenceRefs: refs.map(factRef),
      };
    }
    return {
      status: "met",
      detail: `Found ${joinList(refs.map((r) => `${humanize(String(asRecord(r.value).documentType))} dated ${r.date}`), "and")}.`,
      evidenceRefs: refs.map(factRef),
    };
  },
};

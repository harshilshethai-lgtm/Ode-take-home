import type { Fact, FactRef, SourceType } from "./types";

export const SOURCE_LABEL: Record<SourceType, string> = {
  pt_note: "PT note",
  clinic_note_treating_provider: "clinic note",
  injection_record: "injection record",
  pharmacy_record: "pharmacy record",
  imaging_report: "imaging report",
  patient_reported: "patient-reported",
};

export const SOURCE_LABEL_PLURAL: Record<SourceType, string> = {
  pt_note: "PT notes",
  clinic_note_treating_provider: "clinic notes from the treating provider",
  injection_record: "injection records",
  pharmacy_record: "pharmacy records",
  imaging_report: "imaging reports",
  patient_reported: "patient-reported information",
};

export function humanize(slug: string): string {
  return slug.replace(/_/g, " ");
}

/** "Symptoms materially changed" -> "symptoms_materially_changed". Empty in, empty out. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** ["a","b","c"] -> "a, b, or c"; two items -> "a or b". */
export function joinList(items: string[], conjunction: "and" | "or" = "or"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export const STUDY_LABEL: Record<string, string> = { xray: "X-ray", mri: "MRI", ct: "CT", ultrasound: "ultrasound" };
export function studyLabel(studyType: string): string {
  return STUDY_LABEL[studyType] ?? humanize(studyType);
}

export function bodySiteLabel(bodySite: string): string {
  return humanize(bodySite);
}

export function factRef(f: Fact): FactRef {
  return {
    factId: f.id,
    sourceDocumentId: f.sourceDocumentId,
    sourceType: f.sourceType,
    date: f.date,
    excerpt: f.excerpt,
  };
}

export function factsOfType(facts: Fact[], type: string): Fact[] {
  return facts.filter((f) => f.type === type);
}

/** "PT note, 2026-09-14" */
export function sourceBlurb(f: Fact): string {
  return `${SOURCE_LABEL[f.sourceType]}, ${f.date}`;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// Small constructors for Fact fixtures. Used by seed test cases and unit tests; the engine never imports this.

import type { Fact, Laterality, SourceType } from "./types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

interface Base {
  id?: string;
  doc?: string;
  excerpt?: string;
}

export function symptomOnset(date: string, o: Base & { sourceType?: SourceType } = {}): Fact {
  return {
    id: o.id ?? nextId("onset"),
    type: "symptom_onset",
    value: { description: "Symptom onset" },
    date,
    sourceType: o.sourceType ?? "clinic_note_treating_provider",
    sourceDocumentId: o.doc ?? "doc_office_note",
    excerpt: o.excerpt ?? `Symptoms began ${date}.`,
  };
}

export function treatment(
  o: Base & {
    modality: string;
    start: string;
    end: string;
    sourceType?: SourceType;
    response?: boolean;
    laterality?: Laterality;
  },
): Fact {
  return {
    id: o.id ?? nextId("tx"),
    type: "conservative_treatment",
    value: { modality: o.modality, startDate: o.start, endDate: o.end, responseDocumented: o.response ?? false },
    date: o.end,
    laterality: o.laterality,
    sourceType: o.sourceType ?? "pt_note",
    sourceDocumentId: o.doc ?? "doc_pt_note",
    excerpt: o.excerpt ?? `${o.modality.replace(/_/g, " ")} from ${o.start} to ${o.end}.`,
  };
}

export function study(
  o: Base & { studyType: string; bodySite: string; date: string; laterality?: Laterality },
): Fact {
  return {
    id: o.id ?? nextId("study"),
    type: "imaging_study",
    value: { studyType: o.studyType, bodySite: o.bodySite },
    date: o.date,
    laterality: o.laterality,
    sourceType: "imaging_report",
    sourceDocumentId: o.doc ?? "doc_imaging",
    excerpt: o.excerpt ?? `${o.studyType} ${o.bodySite} on ${o.date}.`,
  };
}

export function historyReviewed(date: string, o: Base = {}): Fact {
  return {
    id: o.id ?? nextId("hist"),
    type: "imaging_history_reviewed",
    value: true,
    date,
    sourceType: "clinic_note_treating_provider",
    sourceDocumentId: o.doc ?? "doc_office_note",
    excerpt: o.excerpt ?? "Imaging history reviewed.",
  };
}

export function condition(slug: string, date: string, o: Base = {}): Fact {
  return {
    id: o.id ?? nextId("cond"),
    type: "exception_condition",
    value: slug,
    date,
    sourceType: "clinic_note_treating_provider",
    sourceDocumentId: o.doc ?? "doc_office_note",
    excerpt: o.excerpt ?? `Documented: ${slug.replace(/_/g, " ")}.`,
  };
}

/** A fact whose type is a named condition set to true, e.g. symptoms_materially_changed. */
export function flagFact(type: string, date: string, o: Base = {}): Fact {
  return {
    id: o.id ?? nextId("flag"),
    type,
    value: true,
    date,
    sourceType: "clinic_note_treating_provider",
    sourceDocumentId: o.doc ?? "doc_office_note",
    excerpt: o.excerpt ?? type.replace(/_/g, " "),
  };
}

export function document(documentType: string, date: string, o: Base = {}): Fact {
  return {
    id: o.id ?? nextId("doc"),
    type: "document",
    value: { documentType },
    date,
    sourceType: "clinic_note_treating_provider",
    sourceDocumentId: o.doc ?? `doc_${documentType}`,
    excerpt: o.excerpt ?? documentType.replace(/_/g, " "),
  };
}

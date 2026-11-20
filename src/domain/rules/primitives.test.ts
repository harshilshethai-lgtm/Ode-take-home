import { describe, expect, it } from "vitest";
import { getPrimitive, listPrimitives } from "./primitives/registry";
import { clinicalJudgment } from "./primitives/clinicalJudgment";
import { evidenceInWindow } from "./primitives/evidenceInWindow";
import { minDuration } from "./primitives/minDuration";
import { noPriorStudyInWindow } from "./primitives/noPriorStudyInWindow";
import { requiredDocumentation } from "./primitives/requiredDocumentation";
import { requiredPriorStudy } from "./primitives/requiredPriorStudy";
import { schemaToFields } from "./schemaFields";
import { document, flagFact, historyReviewed, study, symptomOnset, treatment } from "./factBuilders";
import type { EvaluationContext } from "./types";

const ctx: EvaluationContext = { serviceDate: "2026-11-18", cptCode: "73721", planType: "commercial_hmo", laterality: "left" };

describe("registry", () => {
  it("has the six primitives, each with a schema, describe and evaluate", () => {
    expect(listPrimitives().map((p) => p.type)).toEqual([
      "min_duration",
      "evidence_in_window",
      "required_prior_study",
      "no_prior_study_in_window",
      "required_documentation",
      "clinical_judgment",
    ]);
    for (const p of listPrimitives()) {
      expect(p.paramsSchema, p.type).toBeDefined();
      expect(typeof p.describe).toBe("function");
      expect(typeof p.evaluate).toBe("function");
      expect(getPrimitive(p.type)).toBe(p);
    }
  });

  it("generates form fields (with labels) from every schema", () => {
    for (const p of listPrimitives()) {
      const fields = schemaToFields(p.paramsSchema);
      expect(fields.length, p.type).toBeGreaterThan(0);
      for (const f of fields) expect(f.label.length).toBeGreaterThan(0);
    }
    const f = schemaToFields(evidenceInWindow.paramsSchema);
    expect(f.find((x) => x.name === "allowedSourceTypes")?.kind).toBe("multiselect");
    expect(f.find((x) => x.name === "minWeeks")).toMatchObject({ kind: "number", optional: true, integer: true });
    expect(f.find((x) => x.name === "requireResponseDocumented")?.kind).toBe("boolean");
    expect(f.find((x) => x.name === "allowedModalities")?.kind).toBe("list");
  });
});

describe("min_duration", () => {
  const p = { factType: "symptom_onset", minWeeks: 6 };
  it("describes in plain English", () => {
    expect(minDuration.describe(p)).toBe("Symptoms present for at least 6 weeks.");
  });
  it("met at exactly the threshold, not_met below, unknown with no fact", () => {
    expect(minDuration.evaluate(p, [symptomOnset("2026-10-07")], ctx).status).toBe("met"); // 42 days
    const short = minDuration.evaluate(p, [symptomOnset("2026-10-08")], ctx);
    expect(short.status).toBe("not_met");
    expect(short.detail).toContain("policy requires at least 6 weeks");
    const none = minDuration.evaluate(p, [], ctx);
    expect(none.status).toBe("unknown");
    expect(none.detail).toMatch(/^No documentation found for/);
  });
  it("uses the earliest onset fact", () => {
    const r = minDuration.evaluate(p, [symptomOnset("2026-11-01"), symptomOnset("2026-08-01")], ctx);
    expect(r.status).toBe("met");
    expect(r.evidenceRefs).toHaveLength(1);
  });
});

describe("evidence_in_window", () => {
  const p = {
    factType: "conservative_treatment",
    minWeeks: 6,
    lookbackMonths: 6,
    allowedSourceTypes: ["pt_note", "clinic_note_treating_provider"] as ("pt_note" | "clinic_note_treating_provider")[],
    allowedModalities: ["physical_therapy", "chiropractic", "prescription_medication"],
    requireResponseDocumented: true,
  };
  it("describes the full rule", () => {
    expect(evidenceInWindow.describe(p)).toBe(
      "At least 6 weeks of conservative treatment (physical therapy, chiropractic, or prescription medication) in the past 6 months, documented in PT notes or clinic notes from the treating provider, including the patient's response.",
    );
  });
  it("met with enough documented weeks and response", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", response: true })],
      ctx,
    );
    expect(r.status).toBe("met");
    expect(r.detail).toContain("Found 7 weeks of physical therapy (PT note, 2026-10-20)");
  });
  it("not_met when too few weeks, and names the evidence", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-08-24", end: "2026-09-14", response: true })],
      ctx,
    );
    expect(r.status).toBe("not_met");
    expect(r.detail).toBe(
      "Found 3 weeks of physical therapy (PT note, 2026-09-14); policy requires at least 6 weeks within the past 6 months.",
    );
  });
  it("does not double-count concurrent treatments", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [
        treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-09-29", response: true }),
        treatment({ modality: "prescription_medication", start: "2026-09-08", end: "2026-10-06", response: true, sourceType: "clinic_note_treating_provider" }),
      ],
      ctx,
    );
    // union = Sep 1 .. Oct 6 = 35 days = 5 weeks, not 8
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("Found 5 weeks");
  });
  it("clips treatment that started before the lookback window", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-04-01", end: "2026-06-01", response: true })],
      ctx,
    );
    // window starts 2026-05-18; only 15 days are inside
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("Found 2 weeks");
  });
  it("not_met when all treatment ended before the window", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-01-01", end: "2026-03-01", response: true })],
      ctx,
    );
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("none within the past 6 months");
  });
  it("patient-reported only is not_met with the specified reason", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", sourceType: "patient_reported", response: true })],
      ctx,
    );
    expect(r.status).toBe("not_met");
    expect(r.detail).toBe("Found only in a patient-reported source, which this policy does not accept.");
  });
  it("ignores patient-reported records but still counts accepted ones", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [
        treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", sourceType: "patient_reported", response: true }),
        treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", response: true }),
      ],
      ctx,
    );
    expect(r.status).toBe("met");
    expect(r.detail).toContain("were ignored");
  });
  it("rejects modalities the policy does not list", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "massage", start: "2026-09-01", end: "2026-10-20", response: true })],
      ctx,
    );
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("accepts only physical therapy, chiropractic, or prescription medication");
  });
  it("no evidence is unknown, never not_met", () => {
    const r = evidenceInWindow.evaluate(p, [], ctx);
    expect(r.status).toBe("unknown");
    expect(r.detail).toBe("No documentation found for conservative treatment.");
  });
  it("missing response documentation is unknown", () => {
    const r = evidenceInWindow.evaluate(
      p,
      [treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", response: false })],
      ctx,
    );
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("response to treatment is not documented");
  });
});

describe("required_prior_study", () => {
  const p = { studyType: "xray" as const, bodySite: "knee", withinMonths: 6 };
  it("describes", () => {
    expect(requiredPriorStudy.describe(p)).toBe("X-ray of the knee within the past 6 months.");
    expect(requiredPriorStudy.describe({ studyType: "xray", bodySite: "lumbar_spine" })).toBe("X-ray of the lumbar spine.");
  });
  it("met / not_met (too old) / unknown (missing)", () => {
    expect(requiredPriorStudy.evaluate(p, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02" })], ctx).status).toBe("met");
    expect(requiredPriorStudy.evaluate(p, [study({ studyType: "xray", bodySite: "knee", date: "2026-03-01" })], ctx).status).toBe("not_met");
    const none = requiredPriorStudy.evaluate(p, [study({ studyType: "xray", bodySite: "hip", date: "2026-10-02" })], ctx);
    expect(none.status).toBe("unknown");
    expect(none.detail).toBe("No documentation found for X-ray of the knee.");
  });
  it("without withinMonths any date counts", () => {
    const r = requiredPriorStudy.evaluate(
      { studyType: "xray", bodySite: "knee" },
      [study({ studyType: "xray", bodySite: "knee", date: "2019-01-01" })],
      ctx,
    );
    expect(r.status).toBe("met");
  });
  it("sameLaterality: opposite side is not_met, undocumented side is unknown", () => {
    const q = { ...p, sameLaterality: true };
    expect(requiredPriorStudy.evaluate(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02", laterality: "right" })], ctx).status).toBe("not_met");
    expect(requiredPriorStudy.evaluate(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02" })], ctx).status).toBe("unknown");
    expect(requiredPriorStudy.evaluate(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02", laterality: "left" })], ctx).status).toBe("met");
  });
});

describe("no_prior_study_in_window", () => {
  const p = { studyType: "mri" as const, bodySite: "knee", withinMonths: 12, sameLaterality: true };
  const reviewed = historyReviewed("2026-11-10");
  it("describes", () => {
    expect(noPriorStudyInWindow.describe(p)).toBe("No knee MRI of the same knee in the past 12 months.");
    expect(noPriorStudyInWindow.describe({ ...p, bodySite: "shoulder", sameLaterality: false })).toBe("No shoulder MRI in the past 12 months.");
    expect(noPriorStudyInWindow.describe({ ...p, overrideCondition: "symptoms_materially_changed" })).toContain("a clinician reviews");
  });
  it("met only when history was reviewed and no prior MRI exists", () => {
    expect(noPriorStudyInWindow.evaluate(p, [reviewed], ctx).status).toBe("met");
  });
  it("silence is unknown, not met", () => {
    const r = noPriorStudyInWindow.evaluate(p, [], ctx);
    expect(r.status).toBe("unknown");
    expect(r.detail).toMatch(/^No documentation found/);
  });
  it("a prior MRI inside the window is not_met; outside the window is ignored", () => {
    expect(noPriorStudyInWindow.evaluate(p, [reviewed, study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "left" })], ctx).status).toBe("not_met");
    expect(noPriorStudyInWindow.evaluate(p, [reviewed, study({ studyType: "mri", bodySite: "knee", date: "2025-09-01", laterality: "left" })], ctx).status).toBe("met");
  });
  it("same-side only: the other knee does not count; undocumented side needs review", () => {
    expect(noPriorStudyInWindow.evaluate(p, [reviewed, study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "right" })], ctx).status).toBe("met");
    expect(noPriorStudyInWindow.evaluate(p, [reviewed, study({ studyType: "mri", bodySite: "knee", date: "2026-07-10" })], ctx).status).toBe("needs_review");
  });
  it("not same-side: any side counts", () => {
    const q = { ...p, sameLaterality: false };
    expect(noPriorStudyInWindow.evaluate(q, [reviewed, study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "right" })], ctx).status).toBe("not_met");
  });
  it("override condition forces needs_review, only when documented", () => {
    const q = { ...p, overrideCondition: "symptoms_materially_changed" };
    const prior = study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "left" });
    expect(noPriorStudyInWindow.evaluate(q, [reviewed, prior], ctx).status).toBe("not_met");
    expect(noPriorStudyInWindow.evaluate(q, [reviewed, prior, flagFact("symptoms_materially_changed", "2026-11-10")], ctx).status).toBe("needs_review");
  });
});

describe("required_documentation", () => {
  const p = { documentTypes: ["office_note"] };
  it("describes", () => {
    expect(requiredDocumentation.describe(p)).toBe("Most recent office note attached.");
    expect(requiredDocumentation.describe({ documentTypes: ["office_note"], recencyDays: 30 })).toBe(
      "Most recent office note attached, dated within the past 30 days.",
    );
  });
  it("met when present, unknown when missing or stale", () => {
    expect(requiredDocumentation.evaluate(p, [document("office_note", "2026-11-10")], ctx).status).toBe("met");
    expect(requiredDocumentation.evaluate(p, [], ctx).status).toBe("unknown");
    expect(requiredDocumentation.evaluate({ ...p, recencyDays: 30 }, [document("office_note", "2026-08-01")], ctx).status).toBe("unknown");
  });
});

describe("clinical_judgment", () => {
  it("always needs review and carries the question", () => {
    const p = { question: "Is the instability clinically significant?" };
    expect(clinicalJudgment.describe(p)).toContain(p.question);
    const r = clinicalJudgment.evaluate(p, [], ctx);
    expect(r.status).toBe("needs_review");
    expect(r.detail).toContain(p.question);
  });
});

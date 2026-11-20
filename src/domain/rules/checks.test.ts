import { describe, expect, it } from "vitest";
import { evaluateProperties } from "./checks";
import { describeCriterion } from "./describe";
import { historyReviewed, study, symptomOnset, treatment } from "./factBuilders";
import type { CheckOp, EvaluationContext, Property } from "./types";

const ctx: EvaluationContext = { serviceDate: "2026-11-18", cptCode: "73721", planType: "commercial_hmo", laterality: "left", bodySite: "knee" };

const prop = (key: string, value: Property["value"], op?: CheckOp, fact?: string, unit?: string): Property => ({
  key,
  label: key,
  value,
  ...(unit ? { unit } : {}),
  ...(op ? { check: { op, fact: fact! } } : {}),
});

describe("min_weeks on symptom onset", () => {
  const props = [prop("duration", 6, "min_weeks", "symptom_onset", "weeks")];
  it("met at exactly the threshold, not_met below, unknown with no fact", () => {
    expect(evaluateProperties(props, [symptomOnset("2026-10-07")], ctx).status).toBe("met"); // 42 days
    const short = evaluateProperties(props, [symptomOnset("2026-10-08")], ctx);
    expect(short.status).toBe("not_met");
    expect(short.detail).toContain("policy requires at least 6 weeks");
    const none = evaluateProperties(props, [], ctx);
    expect(none.status).toBe("unknown");
    expect(none.detail).toBe("No documentation found for symptom onset.");
  });
  it("uses the earliest onset fact", () => {
    const r = evaluateProperties(props, [symptomOnset("2026-11-01"), symptomOnset("2026-08-01")], ctx);
    expect(r.status).toBe("met");
    expect(r.evidenceRefs).toHaveLength(1);
  });
});

describe("conservative treatment with filters", () => {
  const props = [
    prop("duration", 6, "min_weeks", "conservative_treatment", "weeks"),
    prop("lookback", 6, "within_months", "conservative_treatment", "months"),
    prop("accepted", ["pt_note", "clinic_note_treating_provider"], "source_in", "conservative_treatment"),
    prop("response", "Required", "present", "treatment_response"),
  ];
  const tx = (o: Partial<Parameters<typeof treatment>[0]> = {}) => treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-20", response: true, ...o });

  it("met with enough documented weeks and a response; one result per property", () => {
    const r = evaluateProperties(props, [tx()], ctx);
    expect(r.status).toBe("met");
    expect(r.detail).toContain("Found 7 weeks of physical therapy (PT note, 2026-10-20)");
    expect(r.propertyResults.map((p) => p.status)).toEqual(["met", "met", "met", "met"]);
  });
  it("not_met when too few weeks, and names the evidence", () => {
    const r = evaluateProperties(props, [tx({ start: "2026-08-24", end: "2026-09-14" })], ctx);
    expect(r.status).toBe("not_met");
    expect(r.detail).toBe("Found 3 weeks of physical therapy (PT note, 2026-09-14); policy requires at least 6 weeks within the past 6 months.");
  });
  it("does not double-count concurrent treatments", () => {
    const r = evaluateProperties(
      props,
      [tx({ start: "2026-09-01", end: "2026-09-29" }), tx({ modality: "prescription_medication", start: "2026-09-08", end: "2026-10-06", sourceType: "clinic_note_treating_provider" })],
      ctx,
    );
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("Found 5 weeks");
  });
  it("clips treatment that started before the lookback window", () => {
    const r = evaluateProperties(props, [tx({ start: "2026-04-01", end: "2026-06-01" })], ctx);
    expect(r.detail).toContain("Found 2 weeks");
  });
  it("not_met when all treatment ended before the window, blamed on the lookback", () => {
    const r = evaluateProperties(props, [tx({ start: "2026-01-01", end: "2026-03-01" })], ctx);
    expect(r.status).toBe("not_met");
    expect(r.detail).toContain("none within the past 6 months");
    expect(r.propertyResults.find((p) => p.key === "lookback")?.status).toBe("not_met");
  });
  it("an unaccepted source only is not_met with the reason", () => {
    const r = evaluateProperties(props, [tx({ sourceType: "patient_reported" })], ctx);
    expect(r.status).toBe("not_met");
    expect(r.detail).toBe("Found conservative treatment only in a patient-reported source, which this policy does not accept.");
  });
  it("ignores unaccepted records but still counts accepted ones", () => {
    const r = evaluateProperties(props, [tx({ sourceType: "patient_reported" }), tx()], ctx);
    expect(r.status).toBe("met");
    expect(r.detail).toContain("were ignored");
  });
  it("no evidence is unknown, never not_met", () => {
    expect(evaluateProperties(props, [], ctx).status).toBe("unknown");
  });
  it("missing response documentation is unknown", () => {
    const r = evaluateProperties(props, [tx({ response: false })], ctx);
    expect(r.status).toBe("unknown");
    expect(r.propertyResults.find((p) => p.key === "response")?.detail).toContain("response to treatment");
  });
  it("source_not_in excludes a source without listing the accepted ones", () => {
    const only = [prop("duration", 4, "min_weeks", "conservative_treatment", "weeks"), prop("excluded", ["patient_reported"], "source_not_in", "conservative_treatment")];
    expect(evaluateProperties(only, [tx({ sourceType: "patient_reported" })], ctx).status).toBe("not_met");
    expect(evaluateProperties(only, [tx({ sourceType: "pharmacy_record" })], ctx).status).toBe("met");
  });
});

describe("prior study present", () => {
  const props = [prop("study", "Knee X-ray", "present", "xray"), prop("lookback", 6, "within_months", "xray", "months")];
  it("met / not_met (too old) / unknown (missing or another body site)", () => {
    expect(evaluateProperties(props, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02" })], ctx).status).toBe("met");
    expect(evaluateProperties(props, [study({ studyType: "xray", bodySite: "knee", date: "2026-03-01" })], ctx).status).toBe("not_met");
    const none = evaluateProperties(props, [study({ studyType: "xray", bodySite: "hip", date: "2026-10-02" })], ctx);
    expect(none.status).toBe("unknown");
    expect(none.detail).toBe("No documentation found for knee X-ray.");
  });
  it("without a lookback any date counts", () => {
    expect(evaluateProperties([props[0]], [study({ studyType: "xray", bodySite: "knee", date: "2019-01-01" })], ctx).status).toBe("met");
  });
  it("same side: opposite side is not_met, undocumented side is unknown", () => {
    const q = [...props, prop("side", true, "same_side", "xray")];
    expect(evaluateProperties(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02", laterality: "right" })], ctx).status).toBe("not_met");
    expect(evaluateProperties(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02" })], ctx).status).toBe("unknown");
    expect(evaluateProperties(q, [study({ studyType: "xray", bodySite: "knee", date: "2026-10-02", laterality: "left" })], ctx).status).toBe("met");
  });
});

describe("prior study absent", () => {
  const props = [prop("prior", "None", "absent", "mri"), prop("lookback", 12, "within_months", "mri", "months"), prop("side", true, "same_side", "mri")];
  const reviewed = historyReviewed("2026-11-10");
  const mri = (date: string, laterality?: "left" | "right") => study({ studyType: "mri", bodySite: "knee", date, laterality });

  it("met only when history was reviewed and no prior MRI exists; silence is unknown", () => {
    expect(evaluateProperties(props, [reviewed], ctx).status).toBe("met");
    expect(evaluateProperties(props, [], ctx).status).toBe("unknown");
  });
  it("a prior MRI inside the window is not_met; outside the window is ignored", () => {
    expect(evaluateProperties(props, [reviewed, mri("2026-07-10", "left")], ctx).status).toBe("not_met");
    expect(evaluateProperties(props, [reviewed, mri("2025-09-01", "left")], ctx).status).toBe("met");
  });
  it("same side only: the other knee does not count; an undocumented side needs review", () => {
    expect(evaluateProperties(props, [reviewed, mri("2026-07-10", "right")], ctx).status).toBe("met");
    expect(evaluateProperties(props, [reviewed, mri("2026-07-10")], ctx).status).toBe("needs_review");
  });
  it("same side off: any side counts", () => {
    const q = [props[0], props[1], prop("side", false, "same_side", "mri")];
    expect(evaluateProperties(q, [reviewed, mri("2026-07-10", "right")], ctx).status).toBe("not_met");
  });
});

describe("properties without a check", () => {
  it("send the criterion to review, but a failing check still wins", () => {
    const unchecked = prop("note", "Clinician judges severity");
    const r = evaluateProperties([unchecked], [], ctx);
    expect(r.status).toBe("needs_review");
    expect(r.propertyResults[0].detail).toMatch(/^Not auto-checked/);
    const mixed = [prop("duration", 6, "min_weeks", "symptom_onset", "weeks"), unchecked];
    expect(evaluateProperties(mixed, [symptomOnset("2026-11-01")], ctx).status).toBe("not_met");
    expect(evaluateProperties(mixed, [], ctx).status).toBe("unknown");
    expect(evaluateProperties(mixed, [symptomOnset("2026-08-01")], ctx).status).toBe("needs_review");
  });
  it("a criterion with no properties is never approved automatically", () => {
    expect(evaluateProperties([], [], ctx).status).toBe("needs_review");
  });
  it("an unknown fact is reviewed, not guessed", () => {
    expect(evaluateProperties([prop("x", 1, "min_weeks", "nonsense", "weeks")], [], ctx).status).toBe("needs_review");
  });
});

describe("describeCriterion", () => {
  it("reads the properties back in plain words", () => {
    expect(
      describeCriterion({
        properties: [prop("duration", 6, "min_weeks", "conservative_treatment", "weeks"), { ...prop("accepted", ["pt_note", "injection_record"], "source_in", "conservative_treatment"), label: "Accepted" }],
      }),
    ).toBe("duration: 6 weeks; Accepted: PT notes or injection records.");
  });
});

import { describe, expect, it } from "vitest";
import { buildSnapshot, evaluateOrder, evaluateSnapshot, rollupOverall, SUBMISSION_BLOCKED_MESSAGE } from "./engine";
import { condition, historyReviewed, study, symptomOnset, treatment } from "./factBuilders";
import { resolvePolicyVersion, type Catalog } from "./resolve";
import { deriveStatus, sharedClaims } from "./versionStatus";
import type { Criterion, EvaluationInput, Payer, Policy, PolicyException, PolicyVersion, Property } from "./types";

/* ---------- a tiny catalog built only from data, to prove the engine has no payer-specific code ---------- */

const payer: Payer = { id: "payer_a", name: "Acme Health", slug: "acme" };
const policy: Policy = { id: "pol_a", payerId: "payer_a", externalPolicyId: "KNEE-1", title: "MRI knee", bodySite: "knee", createdAt: "2026-01-01" };

function crit(key: string, label: string, properties: Property[], sortOrder: number, ref = `(${sortOrder + 1})`): Criterion {
  return {
    id: `c_${key}`, policyVersionId: "v1", key, ref, displayLabel: label, properties, evaluationMode: "auto", failureType: "fixable",
    excerpt: `Excerpt for ${key}`, sortOrder,
  };
}

const p = (key: string, label: string, value: Property["value"], op?: NonNullable<Property["check"]>["op"], fact?: string, unit?: string): Property => ({
  key, label, value, ...(unit ? { unit } : {}), ...(op ? { check: { op, fact: fact! } } : {}),
});

const criteria: Criterion[] = [
  crit("symptom_duration", "Symptom duration", [p("duration", "Duration", 4, "min_weeks", "symptom_onset", "weeks")], 0),
  crit("conservative_care", "Conservative care", [
    p("duration", "Duration", 4, "min_weeks", "conservative_treatment", "weeks"),
    p("lookback", "Lookback", 6, "within_months", "conservative_treatment", "months"),
    p("accepted", "Accepted", ["pt_note", "clinic_note_treating_provider"], "source_in", "conservative_treatment"),
  ], 1),
  crit("prior_xray", "X-ray", [p("study", "Imaging", "Knee X-ray", "present", "xray"), p("lookback", "Lookback", 6, "within_months", "xray", "months")], 2),
  crit("no_recent_mri", "No recent MRI", [
    p("prior", "Prior knee MRI", "None", "absent", "mri"),
    p("lookback", "Lookback", 12, "within_months", "mri", "months"),
    p("side", "Same knee", true, "same_side", "mri"),
  ], 3),
];

const exception: PolicyException = {
  id: "e1", policyVersionId: "v1", key: "acute", ref: "Exceptions", displayLabel: "Acute structural", triggers: ["locked_knee"],
  waivesCriterionKeys: ["symptom_duration", "conservative_care"], evaluationMode: "human_review",
  excerpt: "x", assumption: null,
};

const plans = (planTypes: string[]): Property => ({ key: "plan_types", label: "Plans", value: planTypes });

function version(over: Partial<PolicyVersion> = {}): PolicyVersion {
  return {
    id: "v1", policyId: "pol_a", versionNumber: 1, status: "published", effectiveFrom: "2026-01-01", effectiveTo: null,
    sourceRevisionLabel: null, sourceDocument: null, sourceDocumentHash: null,
    applicability: { cptCodes: ["73721"], settings: "all" },
    logic: "ALL",
    properties: [plans(["commercial_hmo"]), { key: "incomplete_requests", label: "Incomplete requests", value: "deny_resubmit_new" }],
    criteria, exceptions: [exception], changeNote: "init", createdBy: "u", lastEditedBy: "u", publishedBy: "u",
    publishedAt: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-01", clonedFromVersionId: null, ...over,
  };
}

const cat = (versions: PolicyVersion[], extra: Partial<Catalog> = {}): Catalog => ({ payers: [payer], policies: [policy], versions, ...extra });

const goodFacts = () => [
  symptomOnset("2026-09-01"),
  treatment({ modality: "physical_therapy", start: "2026-09-01", end: "2026-10-15", response: true }),
  study({ studyType: "xray", bodySite: "knee", date: "2026-10-01", laterality: "left" }),
  historyReviewed("2026-11-01"),
];

const input = (over: Partial<EvaluationInput> = {}): EvaluationInput => ({
  payerId: "payer_a", planType: "commercial_hmo", cptCode: "73721", serviceDate: "2026-11-18", laterality: "left", facts: goodFacts(), ...over,
});

describe("policy version resolution", () => {
  const v1 = version({ id: "v1", versionNumber: 1, effectiveFrom: "2026-01-01", effectiveTo: "2026-02-28" });
  const v2 = version({ id: "v2", versionNumber: 2, effectiveFrom: "2026-03-01", effectiveTo: null });
  const c = cat([v1, v2]);

  it("picks the version whose window contains the service date (inclusive on both ends)", () => {
    const at = (d: string) => resolvePolicyVersion(c, input({ serviceDate: d }));
    expect(at("2026-01-01")).toMatchObject({ found: true, version: { id: "v1" } });
    expect(at("2026-02-28")).toMatchObject({ found: true, version: { id: "v1" } });
    expect(at("2026-03-01")).toMatchObject({ found: true, version: { id: "v2" } });
    expect(at("2027-06-01")).toMatchObject({ found: true, version: { id: "v2" } });
  });

  it("says why when nothing is effective on that date", () => {
    const r = resolvePolicyVersion(c, input({ serviceDate: "2025-12-31" }));
    expect(r).toMatchObject({ found: false, reason: "no_version_effective" });
    expect(!r.found && r.message).toContain("earliest effective date is 2026-01-01");
  });

  it("says why when the CPT has no policy", () => {
    const r = resolvePolicyVersion(c, input({ cptCode: "99999" }));
    expect(r).toMatchObject({ found: false, reason: "no_policy_for_cpt" });
  });

  it("says why when the plan type is excluded", () => {
    const r = resolvePolicyVersion(c, input({ planType: "commercial_ppo" }));
    expect(r).toMatchObject({ found: false, reason: "plan_type_excluded" });
    expect(!r.found && r.message).toContain("KNEE-1");
  });

  it("respects setting when given", () => {
    const outpatientOnly = cat([version({ applicability: { cptCodes: ["73721"], settings: ["outpatient"] }, properties: [] })]);
    expect(resolvePolicyVersion(outpatientOnly, input({ setting: "inpatient" }))).toMatchObject({ found: false, reason: "setting_excluded" });
    expect(resolvePolicyVersion(outpatientOnly, input({ setting: "outpatient" })).found).toBe(true);
  });

  it("ignores drafts and archived versions; a future-dated version is not used early", () => {
    const draft = version({ id: "d", status: "draft", effectiveFrom: null, publishedAt: null });
    expect(resolvePolicyVersion(cat([draft]), input()).found).toBe(false);
    const scheduled = version({ effectiveFrom: "2027-01-01" });
    expect(resolvePolicyVersion(cat([scheduled]), input({ serviceDate: "2026-11-18" }))).toMatchObject({ found: false, reason: "no_version_effective" });
    expect(resolvePolicyVersion(cat([scheduled]), input({ serviceDate: "2027-01-02" })).found).toBe(true);
  });

  it("only considers policies of the requested payer", () => {
    const other: Policy = { ...policy, id: "pol_b", payerId: "payer_b" };
    const r = resolvePolicyVersion(
      { payers: [payer, { id: "payer_b", name: "Other", slug: "o" }], policies: [policy, other], versions: [version()] },
      input({ payerId: "payer_b" }),
    );
    expect(r).toMatchObject({ found: false, reason: "no_policy_for_cpt" });
  });

  it("evaluateOrder returns no_policy_found with the reason", () => {
    const { outcome, policyVersionId } = evaluateOrder(c, input({ cptCode: "00000" }));
    expect(outcome.overall).toBe("no_policy_found");
    expect(outcome.noPolicyMessage).toContain("00000");
    expect(policyVersionId).toBeNull();
  });
});

describe("derived version status and conflicts", () => {
  it("derives scheduled / active / superseded from dates", () => {
    const v = version({ effectiveFrom: "2026-03-01", effectiveTo: "2026-06-30" });
    expect(deriveStatus(v, "2026-02-01")).toBe("scheduled");
    expect(deriveStatus(v, "2026-03-01")).toBe("active");
    expect(deriveStatus(v, "2026-06-30")).toBe("active");
    expect(deriveStatus(v, "2026-07-01")).toBe("superseded");
    expect(deriveStatus(version({ status: "draft" }), "2026-07-01")).toBe("draft");
    expect(deriveStatus(version({ status: "archived" }), "2026-07-01")).toBe("archived");
  });

  it("finds shared CPT + plan claims; plan types come from the policy properties", () => {
    const scope = (cptCodes: string[], planTypes: string[] | null, settings: "all" | Array<"outpatient" | "inpatient"> = "all") => ({
      applicability: { cptCodes, settings },
      properties: planTypes ? [plans(planTypes)] : [],
    });
    const a = scope(["1", "2"], null);
    expect(sharedClaims(a, scope(["2", "3"], ["x"]))).toEqual({ cptCodes: ["2"], planTypes: ["x"] });
    expect(sharedClaims(a, scope(["9"], null))).toBeNull();
    expect(sharedClaims(scope(["1"], ["x"]), scope(["1"], ["y"]))).toBeNull();
    expect(sharedClaims(scope(["1"], null, ["outpatient"]), scope(["1"], null, ["inpatient"]))).toBeNull();
  });
});

describe("overall rollup", () => {
  it.each([
    [["met", "met"], false, "approve_ready"],
    [["met", "waived"], false, "approve_ready"],
    [["met", "needs_review"], false, "needs_review"],
    [["met", "unknown", "needs_review"], false, "missing_info"],
    [["unknown", "not_met"], false, "not_eligible"],
    [["not_met", "needs_review"], true, "not_eligible"],
    [["met", "waived"], true, "needs_review"],
    [[], false, "needs_review"],
  ] as const)("%j (exception review=%s) -> %s", (statuses, exc, expected) => {
    expect(rollupOverall([...statuses], exc)).toBe(expected);
  });
});

describe("engine", () => {
  const run = (facts = goodFacts(), over: Partial<EvaluationInput> = {}, v = version()) =>
    evaluateOrder(cat([v]), input({ facts, ...over })).outcome;
  const status = (o: ReturnType<typeof run>, key: string) => o.criterionResults.find((r) => r.criterionKey === key)!;

  it("approve_ready when everything is met", () => {
    const o = run();
    expect(o.overall).toBe("approve_ready");
    expect(o.criterionResults.map((r) => r.status)).toEqual(["met", "met", "met", "met"]);
    expect(o.submissionBlocked).toBe(false);
  });

  it("reasons are full sentences that cite payer, policy, version and the insurer's reference", () => {
    const o = run([...goodFacts().filter((f) => f.type !== "conservative_treatment"), treatment({ modality: "physical_therapy", start: "2026-08-24", end: "2026-09-14", response: true })]);
    expect(status(o, "conservative_care").reason).toBe(
      "Not met. Conservative care (Acme Health KNEE-1, v1, (2)): Found 3 weeks of physical therapy (PT note, 2026-09-14); policy requires at least 4 weeks within the past 6 months.",
    );
    expect(o.overall).toBe("not_eligible");
  });

  it("carries the reference, the verbatim excerpt, the rule text and one result per property", () => {
    const r = status(run(), "prior_xray");
    expect(r).toMatchObject({ ref: "(3)", excerpt: "Excerpt for prior_xray" });
    expect(r.ruleText).toBe("Imaging: Knee X-ray; Lookback: 6 months.");
    expect(r.propertyResults?.map((x) => [x.key, x.status])).toEqual([["study", "met"], ["lookback", "met"]]);
  });

  it("missing evidence is never a pass: it is unknown, listed in the checklist, and blocks approval", () => {
    const o = run(goodFacts().filter((f) => f.type !== "imaging_study"));
    expect(status(o, "prior_xray").status).toBe("unknown");
    expect(o.overall).toBe("missing_info");
    expect(o.missingInfoChecklist.map((m) => m.criterionKey)).toEqual(["prior_xray"]);
    expect(o.missingInfoChecklist[0].requirement).toBe("Imaging: Knee X-ray; Lookback: 6 months.");
  });

  it("an empty fact list is missing_info, not approval", () => {
    const o = run([]);
    expect(o.criterionResults.every((r) => r.status === "unknown")).toBe(true);
    expect(o.overall).toBe("missing_info");
  });

  it("submissionBlocked when the payer denies incomplete requests and info is missing", () => {
    const o = run(goodFacts().filter((f) => f.type !== "imaging_study"));
    expect(o.submissionBlocked).toBe(true);
    expect(o.submissionBlockedMessage).toBe(SUBMISSION_BLOCKED_MESSAGE);
  });

  it("does not block when the payer allows amending, or when nothing is missing", () => {
    const amendable = version({ properties: [plans(["commercial_hmo"]), { key: "incomplete_requests", label: "Incomplete requests", value: "amendable" }] });
    const unstated = version({ properties: [plans(["commercial_hmo"])] });
    expect(run(goodFacts().filter((f) => f.type !== "imaging_study"), {}, unstated).submissionBlocked).toBe(false);
    expect(run(goodFacts().filter((f) => f.type !== "imaging_study"), {}, amendable).submissionBlocked).toBe(false);
    expect(run().submissionBlocked).toBe(false);
  });

  it("not_met outranks unknown outranks needs_review", () => {
    const o = run([study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "left" })]);
    expect(o.overall).toBe("not_eligible");
  });

  describe("exceptions and waiver scope", () => {
    const withTrigger = () => [...goodFacts().filter((f) => !["symptom_onset", "conservative_treatment"].includes(f.type)), condition("locked_knee", "2026-11-10")];

    it("waives exactly the listed criteria and marks them waivedByExceptionKey", () => {
      const o = run(withTrigger());
      expect(status(o, "symptom_duration")).toMatchObject({ status: "waived", waivedByExceptionKey: "acute" });
      expect(status(o, "conservative_care")).toMatchObject({ status: "waived", waivedByExceptionKey: "acute" });
      expect(status(o, "prior_xray").status).toBe("met");
      expect(status(o, "prior_xray").waivedByExceptionKey).toBeUndefined();
    });

    it("a human_review exception sets needs_review on the exception and says waived pending clinical confirmation", () => {
      const o = run(withTrigger());
      expect(o.exceptionResults[0]).toMatchObject({ exceptionKey: "acute", status: "needs_review", triggeredBy: ["locked_knee"] });
      expect(status(o, "symptom_duration").reason).toContain("Waived pending clinical confirmation");
      expect(o.overall).toBe("needs_review");
    });

    it("an auto exception applies directly and can reach approve_ready", () => {
      const auto = version({ exceptions: [{ ...exception, evaluationMode: "auto" }] });
      const o = run(withTrigger(), {}, auto);
      expect(o.exceptionResults[0].status).toBe("applied");
      expect(o.overall).toBe("approve_ready");
    });

    it("never waives a criterion that is not listed: a prior MRI still fails", () => {
      const o = run([...withTrigger(), study({ studyType: "mri", bodySite: "knee", date: "2026-07-10", laterality: "left" })]);
      expect(status(o, "no_recent_mri").status).toBe("not_met");
      expect(o.overall).toBe("not_eligible");
    });

    it("does not touch anything when no trigger is present", () => {
      const o = run();
      expect(o.exceptionResults[0].status).toBe("not_triggered");
      expect(o.criterionResults.some((r) => r.status === "waived")).toBe(false);
    });
  });

  it("human_review criteria never auto-pass but keep missing/failed evidence visible", () => {
    const reviewCrit = criteria.map((c) => (c.key === "prior_xray" ? { ...c, evaluationMode: "human_review" as const } : c));
    const met = run(goodFacts(), {}, version({ criteria: reviewCrit }));
    expect(status(met, "prior_xray").status).toBe("needs_review");
    expect(met.overall).toBe("needs_review");
    const missing = run(goodFacts().filter((f) => f.type !== "imaging_study"), {}, version({ criteria: reviewCrit }));
    expect(status(missing, "prior_xray").status).toBe("unknown");
  });

  it("a property without a check is flagged for review, never passed", () => {
    const extra = version({ criteria: [...criteria, crit("judgment", "Severity", [p("note", "Severity", "Clinician judges")], 4)] });
    const o = run(goodFacts(), {}, extra);
    expect(status(o, "judgment").status).toBe("needs_review");
    expect(o.overall).toBe("needs_review");
  });

  it("imaging facts only count for the policy's body site", () => {
    const o = run([...goodFacts().filter((f) => f.type !== "imaging_study"), study({ studyType: "xray", bodySite: "shoulder", date: "2026-10-01", laterality: "left" }), historyReviewed("2026-11-01")]);
    expect(status(o, "prior_xray").status).toBe("unknown");
  });

  it("is deterministic and pinned to a snapshot that includes rule text", () => {
    const v = version();
    const snap = buildSnapshot(payer, policy, v);
    expect(snap.criteria.map((c) => c.text)[0]).toBe("Duration: 4 weeks.");
    const inp = input();
    const a = evaluateSnapshot(snap, inp);
    const b = evaluateSnapshot(snap, inp);
    expect(a).toEqual(b);
    // The snapshot is a copy: editing the source later does not change it.
    v.criteria[0].properties[0].value = 99;
    expect(snap.criteria[0].properties[0].value).toBe(4);
  });
});

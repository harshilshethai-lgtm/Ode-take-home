import { beforeEach, describe, expect, it } from "vitest";
import { evaluateOrder } from "@/domain/rules/engine";
import { runOne } from "@/domain/rules/testRunner";
import type { Criterion, EvaluationInput, RulesUser } from "@/domain/rules/types";
import { buildSeedDb } from "./seed";
import { ApiError, createRulesApi, type RulesApi } from "./service";
import { MemoryStorage, RulesStore } from "./store";
import { condition, historyReviewed, study, symptomOnset, treatment } from "@/domain/rules/factBuilders";

const editor: RulesUser = { id: "u1", name: "Ed Itor", role: "editor" };
const approver: RulesUser = { id: "u2", name: "App Rover", role: "approver" };

let clock = "2026-11-09";
let tick = 0;
let store: RulesStore;
let api: RulesApi;

beforeEach(() => {
  clock = "2026-11-09";
  tick = 0;
  store = new RulesStore(new MemoryStorage(), buildSeedDb);
  api = createRulesApi(store, {
    today: () => clock,
    now: () => new Date(Date.parse(`${clock}T12:00:00.000Z`) + ++tick * 1000).toISOString(),
  });
});

const ferengi = () => api.getPolicy("pol_msk207");
const crit = (v: { criteria: Criterion[] }, key: string) => v.criteria.find((c) => c.key === key)!;

/** Ferengi acceptance flow: change symptom duration 4 -> 6 weeks and publish with a future date. */
function publishFerengiSixWeeks(effectiveFrom = "2026-12-01") {
  const draft = api.createDraft("pol_msk207", { actor: editor });
  const criteria = draft.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, params: { ...c.params, minWeeks: 6 } } : c));
  api.patchVersion(draft.id, { criteria }, editor);
  return api.publishVersion(draft.id, { effectiveFrom, changeNote: "Policy Rev. 4 raises symptom duration to 6 weeks." }, approver);
}

describe("seed data", () => {
  it("has three payers, three policies, one published v1 each, effective 2026-01-01", () => {
    const d = store.getSnapshot();
    expect(d.payers).toHaveLength(3);
    expect(d.policies.map((p) => p.externalPolicyId)).toEqual(["RAD-114", "MSK-207", "IMG-330"]);
    for (const v of d.versions) {
      expect(v.versionNumber).toBe(1);
      expect(api.getVersionById(v.id).version.derivedStatus).toBe("active");
    }
  });

  it("every seeded criterion and exception is schema-valid, cited, and passes publish validation", () => {
    for (const v of store.getSnapshot().versions) {
      const r = api.validateVersion(v.id);
      expect(r.errors, v.id).toEqual([]);
      for (const c of v.criteria) {
        expect(c.sourceCitation.section.length).toBeGreaterThan(0);
        expect(c.sourceCitation.excerpt.length).toBeGreaterThan(10);
      }
    }
  });

  it("has 3-4+ test cases per policy covering clean, missing info, waiver and repeat imaging", () => {
    const d = store.getSnapshot();
    for (const p of d.policies) {
      const cases = d.testCases.filter((t) => t.policyId === p.id);
      expect(cases.length, p.id).toBeGreaterThanOrEqual(4);
      const overall = new Set(cases.map((c) => c.expected.overall));
      for (const o of ["approve_ready", "missing_info", "needs_review", "not_eligible"] as const) expect(overall.has(o), `${p.id} ${o}`).toBe(true);
    }
  });

  it("every seed test case passes against its policy's v1", () => {
    const d = store.getSnapshot();
    for (const t of d.testCases) {
      const policy = d.policies.find((p) => p.id === t.policyId)!;
      const payer = d.payers.find((p) => p.id === policy.payerId)!;
      const version = d.versions.find((v) => v.policyId === policy.id)!;
      const r = runOne(payer, policy, version, t);
      expect(r.failures, `${policy.externalPolicyId} · ${t.name}`).toEqual([]);
    }
  });

  it("records the assumptions the spec calls out", () => {
    const d = store.getSnapshot();
    const flagged = (vid: string) => [...d.versions.find((v) => v.id === vid)!.criteria, ...d.versions.find((v) => v.id === vid)!.exceptions].filter((x) => x.isAssumption).map((x) => x.key);
    expect(flagged("ver_rad114_1")).toEqual([]);
    expect(flagged("ver_msk207_1")).toEqual(["symptom_duration"]);
    expect(flagged("ver_img330_1")).toEqual(["no_recent_mri", "red_flags"]);
  });

  it("encodes the spec: Federation's red flags waive 2a-2c but not 2d", () => {
    const red = store.getSnapshot().versions.find((v) => v.id === "ver_rad114_1")!.exceptions[0];
    expect(red.waivesCriterionKeys).toEqual(["symptom_duration", "conservative_care", "prior_xray"]);
    expect(red.waivesCriterionKeys).not.toContain("no_recent_mri");
  });
});

describe("acceptance: updating a rule through drafts and versions", () => {
  it("changing Ferengi 4 -> 6 weeks: draft, diff, tests, publish with a future date", () => {
    const draft = api.createDraft("pol_msk207", { actor: editor });
    expect(draft).toMatchObject({ versionNumber: 2, derivedStatus: "draft", clonedFromVersionId: "ver_msk207_1" });
    const criteria = draft.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, params: { ...c.params, minWeeks: 6 } } : c));
    api.patchVersion(draft.id, { criteria }, editor);

    // readable diff
    const diff = api.compareVersions("ver_msk207_1", draft.id);
    const sd = diff.criteria.find((c) => c.key === "symptom_duration")!;
    expect(sd.kind).toBe("changed");
    expect(sd.before!.text).toBe("Symptoms present for at least 4 weeks.");
    expect(sd.after!.text).toBe("Symptoms present for at least 6 weeks.");
    expect(sd.changes).toEqual([{ label: "Minimum weeks", from: "4", to: "6" }]);
    expect(sd.segments!.after.filter((s) => s.kind === "add").map((s) => s.text.trim())).toEqual(["6"]);
    expect(diff.criteria.filter((c) => c.kind === "changed")).toHaveLength(1);

    // tests run against both versions; Ferengi's clean case (onset 7 weeks ago) still passes at 6
    const run = api.testVersion(draft.id, editor);
    expect(run.activeVersionId).toBe("ver_msk207_1");
    expect(run.candidateFailing).toBe(0);

    const published = api.publishVersion(draft.id, { effectiveFrom: "2026-12-01", changeNote: "Rev. 4: 6 weeks." }, editor);
    expect(published.derivedStatus).toBe("scheduled");
    expect(api.getVersionById("ver_msk207_1").version).toMatchObject({ effectiveTo: "2026-11-30", derivedStatus: "active" });
  });

  it("evaluations before the effective date use the old version, later ones the new one", () => {
    publishFerengiSixWeeks("2026-12-01");
    const facts = () => [
      symptomOnset("2026-10-20"),
      treatment({ modality: "physical_therapy", start: "2026-10-20", end: "2026-11-25", response: true }),
      study({ studyType: "xray", bodySite: "knee", date: "2026-11-01", laterality: "left" }),
      historyReviewed("2026-11-20"),
    ];
    const mk = (serviceDate: string): EvaluationInput => ({ payerId: "payer_ferengi", planType: "commercial_hmo", cptCode: "73721", serviceDate, laterality: "left", facts: facts() });

    const before = api.evaluate(mk("2026-11-30"), { patientRef: "P1", orderRef: "O1" });
    const after = api.evaluate(mk("2026-12-01"), { patientRef: "P1", orderRef: "O2" });
    expect(before.policyVersionId).toBe("ver_msk207_1");
    expect(after.policyVersionId).not.toBe("ver_msk207_1");
    expect(before.rulesSnapshot!.versionNumber).toBe(1);
    expect(after.rulesSnapshot!.versionNumber).toBe(2);
    // onset 2026-10-20 is 6 weeks before 12-01? 42 days: yes. 5 weeks before service date 11-30? 41 days: 5 weeks.
    expect(before.criterionResults[0].status).toBe("met"); // needs 4
    expect(after.criterionResults[0].status).toBe("met"); // 6 weeks exactly
    // the snapshot carries the criteria text it used
    expect(before.rulesSnapshot!.criteria[0].text).toBe("Symptoms present for at least 4 weeks.");
    expect(after.rulesSnapshot!.criteria[0].text).toBe("Symptoms present for at least 6 weeks.");
  });

  it("a stricter version actually changes the outcome for the same facts", () => {
    publishFerengiSixWeeks("2026-12-01");
    const facts = [symptomOnset("2026-11-01"), treatment({ modality: "physical_therapy", start: "2026-11-01", end: "2026-12-05", response: true }), study({ studyType: "xray", bodySite: "knee", date: "2026-11-10", laterality: "left" }), historyReviewed("2026-12-05")];
    const mk = (serviceDate: string): EvaluationInput => ({ payerId: "payer_ferengi", planType: "commercial_hmo", cptCode: "73721", serviceDate, laterality: "left", facts });
    expect(evaluateOrder(store.getSnapshot(), mk("2026-11-30")).outcome.criterionResults[0].status).toBe("met"); // 29 days = 4 weeks
    expect(evaluateOrder(store.getSnapshot(), mk("2026-12-06")).outcome.criterionResults[0].status).toBe("not_met"); // 35 days = 5 weeks < 6
  });

  it("published versions cannot be modified: PATCH is 409", () => {
    expect(() => api.patchVersion("ver_msk207_1", { changeNote: "sneaky" }, editor)).toThrowError(ApiError);
    try {
      api.patchVersion("ver_msk207_1", { changeNote: "sneaky" }, editor);
    } catch (e) {
      expect((e as ApiError).status).toBe(409);
    }
    const before = JSON.stringify(store.getSnapshot().versions.find((v) => v.id === "ver_msk207_1"));
    expect(() => api.archiveVersion("ver_msk207_1", editor)).toThrowError(/Only drafts/);
    expect(JSON.stringify(store.getSnapshot().versions.find((v) => v.id === "ver_msk207_1"))).toBe(before);
    const v2 = publishFerengiSixWeeks();
    expect(() => api.patchVersion(v2.id, { changeNote: "x" }, editor)).toThrowError(/cannot be modified/);
    expect(() => api.publishVersion(v2.id, { effectiveFrom: "2027-01-01", changeNote: "again" }, editor)).toThrowError(/immutable/);
  });

  it("rollback clones an older version into a new draft and keeps history intact", () => {
    publishFerengiSixWeeks("2026-12-01");
    const rb = api.createDraft("pol_msk207", { actor: editor, cloneFrom: "ver_msk207_1", kind: "rollback" });
    expect(rb).toMatchObject({ versionNumber: 3, clonedFromVersionId: "ver_msk207_1", changeNote: "Rollback to v1." });
    expect(crit(rb, "symptom_duration").params.minWeeks).toBe(4);
    api.publishVersion(rb.id, { effectiveFrom: "2027-01-01", changeNote: "Rollback to v1." }, approver);
    const versions = ferengi().versions;
    expect(versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(versions.map((v) => v.status)).toEqual(["published", "published", "published"]);
    expect(crit(versions[1], "symptom_duration").params.minWeeks).toBe(6); // v2 untouched
    expect(versions[1].effectiveTo).toBe("2026-12-31");
    expect(api.getAudit(rb.id).map((a) => a.action)).toContain("rollback");
    // criteria were cloned with new ids but the same stable keys
    expect(rb.criteria.map((c) => c.key)).toEqual(versions[2].criteria.map((c) => c.key));
    expect(rb.criteria[0].id).not.toBe(versions[2].criteria[0].id);
  });

  it("allows only one open draft per policy, and says where it is", () => {
    const d = api.createDraft("pol_msk207", { actor: editor });
    try {
      api.createDraft("pol_msk207", { actor: editor });
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).status).toBe(409);
      expect((e as ApiError).details).toEqual({ existingDraftId: d.id });
    }
    api.archiveVersion(d.id, editor);
    expect(() => api.createDraft("pol_msk207", { actor: editor })).not.toThrow();
  });
});

describe("publish rules", () => {
  it("requires a change note and an effective date", () => {
    const d = api.createDraft("pol_img330", { actor: editor });
    expect(() => api.publishVersion(d.id, { effectiveFrom: "2026-12-01", changeNote: "  " }, editor)).toThrowError(/errors/);
    const v = api.validateVersion(d.id, { effectiveFrom: null, changeNote: "" });
    expect(v.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["publish.effective.missing", "publish.changeNote.missing"]));
  });

  it("blocks an effective date that would overlap a scheduled version, with an explanation", () => {
    publishFerengiSixWeeks("2026-12-01");
    const d = api.createDraft("pol_msk207", { actor: editor });
    const r = api.validateVersion(d.id, { effectiveFrom: "2026-11-20", changeNote: "oops" });
    expect(r.errors.map((e) => e.code)).toContain("publish.effective.overlap");
    expect(r.errors.find((e) => e.code === "publish.effective.overlap")!.message).toMatch(/overlap v2.*scheduled from 2026-12-01/);
    expect(() => api.publishVersion(d.id, { effectiveFrom: "2026-12-01", changeNote: "same day" }, editor)).toThrowError(/errors/);
    expect(api.validateVersion(d.id, { effectiveFrom: "2026-12-02", changeNote: "ok" }).errors).toEqual([]);
  });

  it("sets effectiveTo on the previous version and writes the audit log", () => {
    const v = publishFerengiSixWeeks("2026-12-01");
    expect(api.getVersionById("ver_msk207_1").version.effectiveTo).toBe("2026-11-30");
    const log = api.getAudit(v.id);
    const pub = log.find((a) => a.action === "published")!;
    expect(pub.actor).toBe(approver.name);
    expect(pub.after).toMatchObject({ effectiveFrom: "2026-12-01", supersedes: { versionNumber: 1, effectiveToAfter: "2026-11-30" } });
    expect(log.map((a) => a.action)).toEqual(expect.arrayContaining(["created_draft", "edited", "published"]));
  });

  it("coalesces rapid autosaves into one audit entry", () => {
    const d = api.createDraft("pol_msk207", { actor: editor });
    for (let i = 0; i < 5; i++) api.patchVersion(d.id, { changeNote: `note ${i}` }, editor);
    expect(api.getAudit(d.id).filter((a) => a.action === "edited")).toHaveLength(1);
  });

  it("derived status moves with the calendar", () => {
    const v = publishFerengiSixWeeks("2026-12-01");
    expect(api.getVersionById(v.id).version.derivedStatus).toBe("scheduled");
    clock = "2026-12-01";
    expect(api.getVersionById(v.id).version.derivedStatus).toBe("active");
    expect(api.getVersionById("ver_msk207_1").version.derivedStatus).toBe("superseded");
  });

  it("two-person rule: publisher must be an approver and not the last editor", () => {
    api.setTwoPersonRule(true);
    const d = api.createDraft("pol_msk207", { actor: approver });
    const req = { effectiveFrom: "2026-12-01", changeNote: "n" };
    expect(() => api.publishVersion(d.id, req, editor)).toThrowError(/approver/);
    expect(() => api.publishVersion(d.id, req, approver)).toThrowError(/someone other than the last editor/);
    api.patchVersion(d.id, { changeNote: "edited" }, editor);
    expect(() => api.publishVersion(d.id, req, approver)).not.toThrow();
  });
});

describe("validation on drafts", () => {
  const draftOf = () => api.createDraft("pol_msk207", { actor: editor });

  it("autosave accepts incomplete drafts and reports the errors", () => {
    const d = draftOf();
    const criteria = d.criteria.map((c) => (c.key === "prior_xray" ? { ...c, sourceCitation: { section: "", excerpt: "" } } : c));
    const { validation } = api.patchVersion(d.id, { criteria }, editor);
    expect(validation.errors.map((e) => e.code)).toContain("criterion.citation.missing");
  });

  it("flags duplicate keys, schema-invalid params and dangling waivers", () => {
    const d = draftOf();
    const dup = [...d.criteria, { ...d.criteria[0], id: "x" }];
    expect(api.patchVersion(d.id, { criteria: dup }, editor).validation.errors.map((e) => e.code)).toContain("criterion.key.duplicate");

    const bad = d.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, params: { factType: "symptom_onset", minWeeks: -2 } } : c));
    expect(api.patchVersion(d.id, { criteria: bad }, editor).validation.errors.map((e) => e.code)).toContain("criterion.params.invalid");

    const dangling = d.exceptions.map((e) => ({ ...e, waivesCriterionKeys: ["symptom_duration", "nope"] }));
    const r = api.patchVersion(d.id, { criteria: d.criteria, exceptions: dangling }, editor).validation;
    expect(r.errors.find((e) => e.code === "exception.waives.unknown")!.message).toContain('"nope"');
  });

  it("requires at least one CPT code", () => {
    const d = draftOf();
    const r = api.patchVersion(d.id, { applicability: { ...d.applicability, cptCodes: [] } }, editor).validation;
    expect(r.errors.map((e) => e.code)).toContain("applicability.cpt.empty");
  });

  it("warns (does not error) about assumptions, few test cases and unspecified incomplete handling", () => {
    const d = api.createDraft("pol_img330", { actor: editor });
    const r = api.validateVersion(d.id);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["assumption", "submission.incomplete.unspecified"]));
  });

  it("flags a CPT + plan conflict with another policy of the same payer, naming both", () => {
    // Give Federation a second policy that claims 72148 for all plans.
    store.mutate((db) => {
      db.policies.push({ id: "pol_other", payerId: "payer_federation", externalPolicyId: "RAD-999", title: "Other", bodySite: "lumbar_spine", createdAt: "2026-01-01" });
      const src = db.versions.find((v) => v.id === "ver_rad114_1")!;
      db.versions.push({ ...structuredClone(src), id: "ver_other_1", policyId: "pol_other", applicability: { cptCodes: ["72148"], planTypes: "all", settings: "all" } });
    });
    const d = api.createDraft("pol_rad114", { actor: editor });
    const r = api.validateVersion(d.id, { effectiveFrom: "2026-12-01", changeNote: "n" });
    const conflict = r.errors.find((e) => e.code === "applicability.conflict")!;
    expect(conflict.message).toContain("Federation Health RAD-114");
    expect(conflict.message).toContain("Federation Health RAD-999");
    expect(conflict.message).toContain("72148");
    // a different payer is fine
    const ok = api.validateVersion(api.createDraft("pol_msk207", { actor: editor }).id, { effectiveFrom: "2026-12-01", changeNote: "n" });
    expect(ok.errors.find((e) => e.code === "applicability.conflict")).toBeUndefined();
  });

  it("no conflict when plan types or dates do not overlap", () => {
    store.mutate((db) => {
      db.policies.push({ id: "pol_other", payerId: "payer_ferengi", externalPolicyId: "MSK-208", title: "Other", bodySite: "knee", createdAt: "2026-01-01" });
      const src = db.versions.find((v) => v.id === "ver_msk207_1")!;
      db.versions.push({ ...structuredClone(src), id: "ver_other_1", policyId: "pol_other", applicability: { cptCodes: ["73721"], planTypes: ["commercial_ppo"], settings: "all" } });
    });
    const d = api.createDraft("pol_msk207", { actor: editor });
    expect(api.validateVersion(d.id, { effectiveFrom: "2026-12-01", changeNote: "n" }).errors.map((e) => e.code)).not.toContain("applicability.conflict");
  });
});

describe("acceptance: evaluation outcomes from the seed policies", () => {
  const run = (policyPayer: string, input: Omit<EvaluationInput, "payerId">) => api.evaluate({ payerId: policyPayer, ...input }, { patientRef: "P", orderRef: "O" });
  const ferengiBase = { planType: "commercial_hmo", cptCode: "73721", serviceDate: "2026-11-18", laterality: "left" as const };
  const xray = study({ studyType: "xray", bodySite: "knee", date: "2026-10-20", laterality: "left" });

  it("patient-reported-only conservative care fails Ferengi but passes Andorian when backed by a clinic note", () => {
    const reported = treatment({ modality: "physical_therapy", start: "2026-10-01", end: "2026-11-05", sourceType: "patient_reported" });
    const f = run("payer_ferengi", { ...ferengiBase, facts: [symptomOnset("2026-10-01"), reported, xray, historyReviewed("2026-11-10")] });
    expect(f.criterionResults.find((r) => r.criterionKey === "conservative_care")).toMatchObject({ status: "not_met" });
    expect(f.criterionResults.find((r) => r.criterionKey === "conservative_care")!.reason).toContain("Found only in a patient-reported source, which this policy does not accept.");

    const andorianBase = { planType: "commercial_ppo", cptCode: "73221", serviceDate: "2026-11-18", laterality: "right" as const };
    const shoulderXray = study({ studyType: "xray", bodySite: "shoulder", date: "2026-10-05", laterality: "right" });
    const clinicNote = treatment({ modality: "physical_therapy", start: "2026-09-28", end: "2026-11-09", sourceType: "clinic_note_treating_provider" });
    const reportedLong = treatment({ modality: "physical_therapy", start: "2026-09-28", end: "2026-11-09", sourceType: "patient_reported" });
    const a = run("payer_andorian", { ...andorianBase, facts: [symptomOnset("2026-09-21"), reportedLong, clinicNote, shoulderXray, historyReviewed("2026-11-12")] });
    expect(a.overall).toBe("approve_ready");
    const onlyReported = run("payer_andorian", { ...andorianBase, facts: [symptomOnset("2026-09-21"), reportedLong, shoulderXray, historyReviewed("2026-11-12")] });
    expect(onlyReported.criterionResults.find((r) => r.criterionKey === "conservative_care")!.status).toBe("not_met");
  });

  it("Federation red flag waives 2a-2c but still fails a lumbar MRI 4 months ago", () => {
    const e = run("payer_federation", {
      planType: "commercial_ppo", cptCode: "72148", serviceDate: "2026-11-18",
      facts: [condition("cauda_equina_symptoms", "2026-11-17"), study({ studyType: "mri", bodySite: "lumbar_spine", date: "2026-07-18" }), historyReviewed("2026-11-17")],
    });
    const by = Object.fromEntries(e.criterionResults.map((r) => [r.criterionKey, r.status]));
    expect(by).toEqual({ symptom_duration: "waived", conservative_care: "waived", prior_xray: "waived", no_recent_mri: "not_met" });
    expect(e.overall).toBe("not_eligible");
  });

  it("Ferengi with a missing X-ray is submissionBlocked", () => {
    const e = run("payer_ferengi", { ...ferengiBase, facts: [symptomOnset("2026-10-01"), treatment({ modality: "physical_therapy", start: "2026-10-01", end: "2026-11-05" }), historyReviewed("2026-11-10")] });
    expect(e.overall).toBe("missing_info");
    expect(e.submissionBlocked).toBe(true);
    expect(e.submissionBlockedMessage).toBe("This payer does not allow amending incomplete requests; resolve all items before submitting.");
    expect(e.missingInfoChecklist.map((m) => m.criterionKey)).toEqual(["prior_xray"]);
  });

  it("Ferengi excludes other plan types, and says why", () => {
    const e = run("payer_ferengi", { ...ferengiBase, planType: "commercial_ppo", facts: [] });
    expect(e.overall).toBe("no_policy_found");
    expect(e.noPolicyReason).toBe("plan_type_excluded");
    expect(e.policyVersionId).toBeNull();
  });

  it("every evaluation links to its exact version, criterion text and citation, even after supersession", () => {
    const e = run("payer_ferengi", { ...ferengiBase, facts: [symptomOnset("2026-10-01")] });
    publishFerengiSixWeeks("2026-11-19");
    clock = "2026-11-19";
    const trace = api.getEvaluation(e.id);
    expect(trace.version).toMatchObject({ id: "ver_msk207_1", derivedStatus: "superseded" });
    expect(trace.supersededBy).toMatchObject({ versionNumber: 2, effectiveFrom: "2026-11-19" });
    const r = trace.evaluation.criterionResults[0];
    expect(r.sourceCitation.excerpt).toBe("(1) knee pain for at least 4 weeks;");
    expect(trace.evaluation.rulesSnapshot!.versionId).toBe("ver_msk207_1");

    // The service date (11-18) is before v2 takes effect, so v1 still governs the same order...
    const same = api.rerunEvaluation(e.id);
    expect(same.policyVersionId).toBe("ver_msk207_1");
    expect(same.input).toEqual(e.input);
    // ...but if the scan is rescheduled past that date, the re-run picks up the new rules.
    const moved = api.rerunEvaluation(e.id, { serviceDate: "2026-11-25" });
    expect(moved.policyVersionId).not.toBe("ver_msk207_1");
    expect(moved.rulesSnapshot!.versionNumber).toBe(2);
  });
});

describe("coverage gaps and search", () => {
  it("lists PA-required CPTs with no criteria, assumptions, and missing tests", () => {
    const g = api.getCoverageGaps();
    expect(g.cptWithoutCriteria.map((c) => c.cptCode).sort()).toEqual(["72141", "73218", "73718"]);
    expect(g.assumptionVersions.map((a) => a.policy.externalPolicyId).sort()).toEqual(["IMG-330", "MSK-207"]);
    expect(g.policiesWithoutTests).toEqual([]);
    expect(g.sourceChanged).toEqual([]);
  });

  it("flags policies whose source document hash changed since publish", () => {
    api.observeSourceHash("fixtures/policies/insurer-policy-excerpts.pdf", "deadbeef");
    expect(api.getCoverageGaps().sourceChanged).toHaveLength(3);
  });

  it("flags a policy with no test cases", () => {
    store.mutate((db) => {
      db.testCases = db.testCases.filter((t) => t.policyId !== "pol_img330");
    });
    expect(api.getCoverageGaps().policiesWithoutTests.map((p) => p.policy.externalPolicyId)).toEqual(["IMG-330"]);
  });

  it("CPT search says which policy governs a code", () => {
    expect(api.findPolicyForCpt("72148")).toMatchObject([{ policy: { externalPolicyId: "RAD-114" }, status: "governs" }]);
    expect(api.findPolicyForCpt("00000")).toEqual([]);
    expect(api.listPolicies({ cpt: "73221" }).map((s) => s.policy.externalPolicyId)).toEqual(["IMG-330"]);
    expect(api.listPolicies({ hasAssumptions: true }).map((s) => s.policy.externalPolicyId)).toEqual(["IMG-330", "MSK-207"]);
    expect(api.listPolicies({ payerId: "payer_federation" })).toHaveLength(1);
  });

  it("saves an evaluation as a golden test case", () => {
    const e = api.getEvaluation("eval_seed_3").evaluation;
    const tc = api.saveEvaluationAsTestCase(e.id, "Saved case", editor);
    expect(tc.expected).toMatchObject({ overall: "missing_info", submissionBlocked: true });
    expect(ferengi().testCases.map((t) => t.name)).toContain("Saved case");
  });
});

describe("store", () => {
  it("persists across instances and rolls back a failed mutation", () => {
    const storage = new MemoryStorage();
    const s1 = new RulesStore(storage, buildSeedDb);
    const a1 = createRulesApi(s1, { today: () => "2026-11-09", now: () => "2026-11-09T12:00:00.000Z" });
    a1.createDraft("pol_msk207", { actor: editor });
    const s2 = new RulesStore(storage, buildSeedDb);
    expect(s2.getSnapshot().versions.filter((v) => v.policyId === "pol_msk207")).toHaveLength(2);

    const before = s2.getSnapshot();
    expect(() => s2.mutate((d) => { d.versions.length = 0; throw new Error("boom"); })).toThrow();
    expect(s2.getSnapshot()).toBe(before);
  });

  it("falls back to seed data for a newer or corrupt document", () => {
    const storage = new MemoryStorage();
    storage.setItem("halcyon.rules.db", JSON.stringify({ schemaVersion: 999 }));
    expect(new RulesStore(storage, buildSeedDb).getSnapshot().policies).toHaveLength(3);
    storage.setItem("halcyon.rules.db", "{not json");
    expect(new RulesStore(storage, buildSeedDb).getSnapshot().policies).toHaveLength(3);
  });
});

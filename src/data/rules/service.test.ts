import { beforeEach, describe, expect, it } from "vitest";
import { evaluateOrder } from "@/domain/rules/engine";
import { runOne } from "@/domain/rules/testRunner";
import type { Criterion, EvaluationInput, RulesUser } from "@/domain/rules/types";
import { changedPublished, publishedFingerprint } from "@/domain/rules/immutability";
import { buildSeedDb, SEED_PDF_HASH } from "./seed";
import { ApiError, createRulesApi, type RulesApi } from "./service";
import { MemoryStorage, RulesStore } from "./store";
import { evaluateProperties } from "@/domain/rules/checks";
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
const weeks = (c: Pick<Criterion, "properties">) => c.properties.find((p) => p.key === "duration")?.value;
const withWeeks = <C extends Pick<Criterion, "properties">>(c: C, n: number): C => ({ ...c, properties: c.properties.map((p) => (p.key === "duration" ? { ...p, value: n } : p)) });

/** Ferengi acceptance flow: change symptom duration 4 -> 6 weeks and publish with a future date. */
function publishFerengiSixWeeks(effectiveFrom = "2026-12-01") {
  const draft = api.createDraft("pol_msk207", { actor: editor });
  const criteria = draft.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, 6) : c));
  api.patchVersion(draft.id, { criteria }, editor);
  return api.publishVersion(draft.id, { effectiveFrom, changeNote: "Policy Rev. 4 raises symptom duration to 6 weeks." }, approver);
}

describe("seed data", () => {
  it("has three payers, three policies, one published version each (RAD-114 v3, others v1), effective 2026-01-01", () => {
    const d = store.getSnapshot();
    expect(d.payers).toHaveLength(3);
    expect(d.policies.map((p) => p.externalPolicyId)).toEqual(["RAD-114", "MSK-207", "IMG-330"]);
    const numbers = (id: string) => d.versions.filter((v) => v.policyId === id).map((v) => v.versionNumber).sort();
    expect(numbers("pol_rad114")).toEqual([1, 2, 3]);
    expect(numbers("pol_msk207")).toEqual([1]);
    expect(numbers("pol_img330")).toEqual([1]);
    for (const v of d.versions.filter((x) => x.versionNumber === (x.policyId === "pol_rad114" ? 3 : 1))) {
      expect(v.effectiveFrom).toBe("2026-01-01");
      expect(api.getVersionById(v.id).version.derivedStatus).toBe("active");
    }
    // the next draft continues the numbering
    expect(api.createDraft("pol_rad114", { actor: editor }).versionNumber).toBe(4);
  });

  it("seeds the spec's failure types, waiver scope, plans, submission and assumptions", () => {
    const d = store.getSnapshot();
    const v = (id: string) => d.versions.filter((x) => x.policyId === id).sort((a, b) => b.versionNumber - a.versionNumber)[0];
    const fail = (id: string) => v(id).criteria.map((c) => c.failureType);
    expect(fail("pol_rad114")).toEqual(["clinical", "fixable", "fixable", "clinical"]);
    expect(fail("pol_msk207")).toEqual(["clinical", "fixable", "fixable", "clinical"]);
    expect(fail("pol_img330")).toEqual(["clinical", "fixable", "fixable", "clinical"]);

    const prop = (id: string, key: string) => v(id).properties.find((p) => p.key === key)?.value;
    expect(v("pol_msk207").applicability).toMatchObject({ cptCodes: ["73721", "73722", "73723"] });
    expect(prop("pol_msk207", "plan_types")).toEqual(["commercial_hmo"]);
    expect(prop("pol_msk207", "channels")).toEqual(["portal"]);
    expect(prop("pol_msk207", "incomplete_requests")).toBe("deny_resubmit_new");
    expect(v("pol_msk207").exceptions[0].waivesCriterionKeys).toEqual(["symptom_duration", "conservative_care"]);
    // "Electronic submission through the Federation Health provider API or portal."
    expect(prop("pol_rad114", "channels")).toEqual(["api", "portal"]);
    expect(prop("pol_rad114", "plan_types")).toBeUndefined();
    expect(prop("pol_rad114", "incomplete_requests")).toBeUndefined();
    expect(v("pol_rad114").exceptions[0].waivesCriterionKeys).toEqual(["symptom_duration", "conservative_care", "prior_xray"]);

    expect(v("pol_img330").sourceRevisionLabel).toBeNull();
    expect(v("pol_img330").properties.map((p) => p.key)).toEqual(["channels"]);
    expect(v("pol_img330").exceptions[0].triggers).toHaveLength(5);
  });

  it("uses the insurer's own references, never invented numbering", () => {
    const refs = (vid: string) => store.getSnapshot().versions.find((v) => v.id === vid)!.criteria.map((c) => c.ref);
    expect(refs("ver_rad114_3")).toEqual(["2a", "2b", "2c", "2d"]);
    expect(refs("ver_rad114_1")).toEqual(["2a", "2b", "2c"]);
    expect(refs("ver_msk207_1")).toEqual(["(1)", "(2)", "(3)", "(4)"]);
    expect(refs("ver_img330_1")).toEqual(["Duration of symptoms", "Conservative care", "Imaging first", "Repeat imaging"]);
  });

  it("only Ferengi excludes patient-reported treatment, because only Ferengi says so", () => {
    const excludes = (vid: string) =>
      store
        .getSnapshot()
        .versions.find((v) => v.id === vid)!
        .criteria.flatMap((c) => c.properties)
        .some((p) => p.check?.op === "source_not_in" || (p.check?.op === "source_in" && !(p.value as string[]).includes("patient_reported")) ? (p.value as string[]).includes("patient_reported") : false);
    expect(excludes("ver_msk207_1")).toBe(true);
    expect(excludes("ver_rad114_3")).toBe(false);
    expect(excludes("ver_img330_1")).toBe(false);
  });

  it("every seeded criterion and exception is schema-valid, cited, and passes publish validation", () => {
    for (const v of store.getSnapshot().versions) {
      const r = api.validateVersion(v.id);
      expect(r.errors, v.id).toEqual([]);
      for (const c of v.criteria) {
        expect(c.ref.length).toBeGreaterThan(0);
        expect(c.excerpt.length).toBeGreaterThan(10);
        expect(c.properties.length).toBeGreaterThan(0);
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

  it("every seed test case passes against its policy's current version", () => {
    const d = store.getSnapshot();
    for (const t of d.testCases) {
      const policy = d.policies.find((p) => p.id === t.policyId)!;
      const payer = d.payers.find((p) => p.id === policy.payerId)!;
      const version = d.versions.filter((v) => v.policyId === policy.id).sort((a, b) => b.versionNumber - a.versionNumber)[0];
      const r = runOne(payer, policy, version, t);
      expect(r.failures, `${policy.externalPolicyId} · ${t.name}`).toEqual([]);
    }
  });

  it("marks every inferred value as an assumption, and nothing the insurer states", () => {
    const d = store.getSnapshot();
    const flagged = (vid: string) => {
      const v = d.versions.find((x) => x.id === vid)!;
      return [
        ...v.properties.filter((p) => p.assumption).map((p) => `policy.${p.key}`),
        ...v.criteria.flatMap((c) => c.properties.filter((p) => p.assumption).map((p) => `${c.key}.${p.key}`)),
        ...v.exceptions.filter((e) => e.assumption).map((e) => e.key),
      ];
    };
    expect(flagged("ver_rad114_3")).toEqual([]);
    expect(flagged("ver_msk207_1")).toEqual(["policy.joint"]);
    expect(flagged("ver_img330_1")).toEqual(["no_recent_mri.prior_study", "no_recent_mri.same_side", "red_flags"]);
  });

  it("encodes the spec: Federation's red flags waive 2a-2c but not 2d", () => {
    const red = store.getSnapshot().versions.find((v) => v.id === "ver_rad114_3")!.exceptions[0];
    expect(red.waivesCriterionKeys).toEqual(["symptom_duration", "conservative_care", "prior_xray"]);
    expect(red.waivesCriterionKeys).not.toContain("no_recent_mri");
  });
});

describe("acceptance: updating a rule through drafts and versions", () => {
  it("changing Ferengi 4 -> 6 weeks: draft, diff, tests, publish with a future date", () => {
    const draft = api.createDraft("pol_msk207", { actor: editor });
    expect(draft).toMatchObject({ versionNumber: 2, derivedStatus: "draft", clonedFromVersionId: "ver_msk207_1" });
    const criteria = draft.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, 6) : c));
    api.patchVersion(draft.id, { criteria }, editor);

    // readable diff
    const diff = api.compareVersions("ver_msk207_1", draft.id);
    const sd = diff.criteria.find((c) => c.key === "symptom_duration")!;
    expect(sd.kind).toBe("changed");
    expect(sd.before!.text).toBe("Duration: 4 weeks.");
    expect(sd.after!.text).toBe("Duration: 6 weeks.");
    expect(sd.changes).toEqual([{ label: "Duration", from: "4 weeks", to: "6 weeks" }]);
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
    expect(before.rulesSnapshot!.criteria[0].text).toBe("Duration: 4 weeks.");
    expect(after.rulesSnapshot!.criteria[0].text).toBe("Duration: 6 weeks.");
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
    expect(weeks(crit(rb, "symptom_duration"))).toBe(4);
    api.publishVersion(rb.id, { effectiveFrom: "2027-01-01", changeNote: "Rollback to v1." }, approver);
    const versions = ferengi().versions;
    expect(versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(versions.map((v) => v.status)).toEqual(["published", "published", "published"]);
    expect(weeks(crit(versions[1], "symptom_duration"))).toBe(6); // v2 untouched
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
    const criteria = d.criteria.map((c) => (c.key === "prior_xray" ? { ...c, ref: "", excerpt: "" } : c));
    const { validation } = api.patchVersion(d.id, { criteria }, editor);
    expect(validation.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["criterion.ref.missing", "criterion.excerpt.missing"]));
  });

  it("flags duplicate keys, invalid property values and dangling waivers", () => {
    const d = draftOf();
    const dup = [...d.criteria, { ...d.criteria[0], id: "x" }];
    expect(api.patchVersion(d.id, { criteria: dup }, editor).validation.errors.map((e) => e.code)).toContain("criterion.key.duplicate");

    const bad = d.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, -2) : c));
    expect(api.patchVersion(d.id, { criteria: bad }, editor).validation.errors.map((e) => e.code)).toContain("property.value.number");
    const noFact = d.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, properties: [{ ...c.properties[0], check: { op: "min_weeks" as const, fact: "" } }] } : c));
    expect(api.patchVersion(d.id, { criteria: noFact }, editor).validation.errors.map((e) => e.code)).toContain("property.check.fact");

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
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["assumption", "policy.incomplete.unspecified"]));
  });

  it("flags a CPT + plan conflict with another policy of the same payer, naming both", () => {
    // Give Federation a second policy that claims 72148 for all plans.
    store.mutate((db) => {
      db.policies.push({ id: "pol_other", payerId: "payer_federation", externalPolicyId: "RAD-999", title: "Other", bodySite: "lumbar_spine", createdAt: "2026-01-01" });
      const src = db.versions.find((v) => v.id === "ver_rad114_3")!;
      db.versions.push({ ...structuredClone(src), id: "ver_other_1", policyId: "pol_other", applicability: { cptCodes: ["72148"], settings: "all" }, properties: [] });
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
      db.versions.push({ ...structuredClone(src), id: "ver_other_1", policyId: "pol_other", applicability: { cptCodes: ["73721"], settings: "all" }, properties: [{ key: "plan_types", label: "Plans", value: ["commercial_ppo"] }] });
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
    expect(f.criterionResults.find((r) => r.criterionKey === "conservative_care")!.reason).toContain("Found conservative treatment only in a patient-reported source, which this policy does not accept.");

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
    expect(r).toMatchObject({ ref: "(1)", excerpt: "(1) knee pain for at least 4 weeks;" });
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

  it("upgrades a v1 document: untouched seed data is re-seeded, edited data keeps its edits and gains failure types", () => {
    const old = (mutate: (d: { versions: Array<Record<string, unknown>> }) => void) => {
      const doc = structuredClone(buildSeedDb()) as unknown as { schemaVersion: number; versions: Array<Record<string, unknown> & { criteria: Array<Record<string, unknown>> }> };
      doc.schemaVersion = 1;
      // A v1 document still had rule types; the v1 -> v2 step reads them to pick failure types.
      const LEGACY_TYPE: Record<string, string> = { symptom_duration: "min_duration", no_recent_mri: "no_prior_study_in_window" };
      for (const v of doc.versions) for (const c of v.criteria) {
        delete c.failureType;
        c.type = LEGACY_TYPE[c.key as string] ?? "evidence_in_window";
      }
      mutate(doc);
      const storage = new MemoryStorage();
      storage.setItem("halcyon.rules.db", JSON.stringify(doc));
      return new RulesStore(storage, buildSeedDb).getSnapshot();
    };

    const reseeded = old(() => {});
    expect(reseeded.versions.filter((v) => v.policyId === "pol_rad114")).toHaveLength(3);

    const edited = old((d) => {
      d.versions[0].createdBy = "Dana Whitfield";
    });
    expect(edited.schemaVersion).toBe(4);
    expect(edited.versions[0].createdBy).toBe("Dana Whitfield");
    expect(edited.versions.find((v) => v.id === "ver_rad114_3")!.criteria.map((c) => c.failureType)).toEqual(["clinical", "fixable", "fixable", "clinical"]);
    expect(edited.versions.find((v) => v.id === "ver_rad114_3")!.criteria[0]).not.toHaveProperty("type");
  });

  it("upgrades a v3 document: type + params become properties, sections become refs, submission becomes policy properties", () => {
    const legacy = {
      ...structuredClone(buildSeedDb()),
      schemaVersion: 3,
      versions: [
        {
          ...structuredClone(buildSeedDb().versions.find((v) => v.id === "ver_msk207_1")!),
          createdBy: "Dana Whitfield",
          properties: undefined,
          applicability: { cptCodes: ["73721"], planTypes: ["commercial_hmo"], settings: "all" },
          submission: { channels: ["portal"], requiredAttachments: [], incompleteRequestHandling: "deny_resubmit_new" },
          criteria: [
            {
              id: "c1", policyVersionId: "ver_msk207_1", key: "conservative_care", displayLabel: "Conservative care", failureType: "fixable", evaluationMode: "auto", sortOrder: 0,
              type: "evidence_in_window",
              params: { factType: "conservative_treatment", minWeeks: 4, allowedSourceTypes: ["pt_note"], excludedSourceTypes: ["patient_reported"] },
              sourceCitation: { section: "Criteria (2)", excerpt: "(2) at least 4 weeks of conservative treatment" },
              interpretationNote: "Guessed the sources.", isAssumption: true,
            },
          ],
          exceptions: [],
        },
      ],
    };
    const storage = new MemoryStorage();
    storage.setItem("halcyon.rules.db", JSON.stringify(legacy));
    const v = new RulesStore(storage, buildSeedDb).getSnapshot().versions[0];
    expect(v.properties.map((p) => [p.key, p.value])).toEqual([
      ["plan_types", ["commercial_hmo"]],
      ["channels", ["portal"]],
      ["incomplete_requests", "deny_resubmit_new"],
    ]);
    expect(v.applicability).toEqual({ cptCodes: ["73721"], settings: "all" });
    const c = v.criteria[0];
    expect(c).toMatchObject({ ref: "(2)", excerpt: "(2) at least 4 weeks of conservative treatment" });
    expect(c.properties.map((p) => [p.key, p.check?.op])).toEqual([
      ["duration", "min_weeks"],
      ["accepted_sources", "source_in"],
      ["excluded_sources", "source_not_in"],
    ]);
    expect(c.properties[0].assumption).toBe("Guessed the sources.");
    expect(c).not.toHaveProperty("params");
  });

  it("falls back to seed data for a newer or corrupt document", () => {
    const storage = new MemoryStorage();
    storage.setItem("halcyon.rules.db", JSON.stringify({ schemaVersion: 999 }));
    expect(new RulesStore(storage, buildSeedDb).getSnapshot().policies).toHaveLength(3);
    storage.setItem("halcyon.rules.db", "{not json");
    expect(new RulesStore(storage, buildSeedDb).getSnapshot().policies).toHaveLength(3);
  });
});

describe("version history", () => {
  const status = (id: string) => api.getVersionById(id).version.derivedStatus;
  const rad = ["ver_rad114_1", "ver_rad114_2", "ver_rad114_3"];

  it("derives Active / Superseded / Scheduled from the dates alone", () => {
    expect(rad.map(status)).toEqual(["superseded", "superseded", "active"]);

    clock = "2025-08-01";
    expect(rad.map(status)).toEqual(["superseded", "active", "scheduled"]);

    clock = "2025-01-01";
    expect(rad.map(status)).toEqual(["active", "scheduled", "scheduled"]);

    clock = "2024-12-31";
    expect(rad.map(status)).toEqual(["scheduled", "scheduled", "scheduled"]);
  });

  it("ranges tile with no gap or overlap, and exactly one version is active on any day", () => {
    const vs = store.getSnapshot().versions.filter((v) => v.policyId === "pol_rad114").sort((a, b) => a.versionNumber - b.versionNumber);
    expect(vs.map((v) => [v.effectiveFrom, v.effectiveTo])).toEqual([
      ["2025-01-01", "2025-06-30"],
      ["2025-07-01", "2025-12-31"],
      ["2026-01-01", null],
    ]);
    for (const day of ["2025-03-01", "2025-06-30", "2025-07-01", "2025-12-31", "2026-01-01", "2027-05-05"]) {
      clock = day;
      expect(rad.filter((id) => status(id) === "active"), day).toHaveLength(1);
    }
  });

  it("history is non-trivial: v2 added the X-ray criterion, v3 widened the conservative-care lookback", () => {
    const v1v2 = api.compareVersions("ver_rad114_1", "ver_rad114_2");
    expect(v1v2.criteria.find((c) => c.key === "prior_xray")!.kind).toBe("added");
    const mri = v1v2.criteria.find((c) => c.key === "no_recent_mri")!;
    expect(mri.kind).toBe("changed");
    expect(mri.citationChanges).toContainEqual({ label: "Reference", from: "2c", to: "2d" });

    const v2v3 = api.compareVersions("ver_rad114_2", "ver_rad114_3");
    expect(v2v3.criteria.filter((c) => c.kind !== "unchanged").map((c) => c.key)).toEqual(["conservative_care"]);
    expect(v2v3.criteria.find((c) => c.key === "conservative_care")!.changes).toEqual([{ label: "Lookback", from: "3 months", to: "6 months" }]);
  });

  it("every version carries who published it, when, and why", () => {
    for (const id of rad) {
      const v = api.getVersionById(id).version;
      expect(v.publishedBy, id).toBeTruthy();
      expect(v.publishedAt, id).toBeTruthy();
      expect(v.changeNote, id).toBeTruthy();
    }
  });

  it("the active version is still the one evaluations resolve to", () => {
    const e = api.evaluate({ payerId: "payer_federation", planType: "ppo", cptCode: "72148", serviceDate: "2026-11-18", facts: [] }, { patientRef: "p", orderRef: "o" });
    expect(e.policyVersionId).toBe("ver_rad114_3");
    const old = api.evaluate({ payerId: "payer_federation", planType: "ppo", cptCode: "72148", serviceDate: "2025-08-15", facts: [] }, { patientRef: "p", orderRef: "o" });
    expect(old.policyVersionId).toBe("ver_rad114_2");
  });
});

describe("published versions are immutable (409)", () => {
  const snapshot = () => JSON.stringify(store.getSnapshot().versions);
  const expect409 = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(409);
      return;
    }
    throw new Error("expected a 409");
  };

  const states: Array<[string, string, string]> = [
    ["superseded", "ver_rad114_1", "2026-11-09"],
    ["superseded", "ver_rad114_2", "2026-11-09"],
    ["active", "ver_rad114_3", "2026-11-09"],
    ["scheduled", "ver_rad114_3", "2025-11-01"],
  ];

  it.each(states)("rejects editing a %s version (%s on %s) and leaves it untouched", (_label, id, day) => {
    clock = day;
    const v = api.getVersionById(id).version;
    const before = snapshot();
    const auditBefore = store.getSnapshot().auditLog.length;

    // the criteria themselves
    expect409(() =>
      api.patchVersion(id, { criteria: v.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, 99) : c)) }, editor),
    );
    // waivers, applicability, policy properties, change note, effective date
    expect409(() => api.patchVersion(id, { exceptions: [] }, editor));
    expect409(() => api.patchVersion(id, { applicability: { ...v.applicability, cptCodes: ["99999"] } }, editor));
    expect409(() => api.patchVersion(id, { properties: [...v.properties, { key: "channels", label: "Submit via", value: ["fax"] }] }, editor));
    expect409(() => api.patchVersion(id, { changeNote: "rewritten history" }, editor));
    expect409(() => api.patchVersion(id, { effectiveFrom: "2030-01-01" }, editor));
    // lifecycle
    expect409(() => api.archiveVersion(id, editor));
    expect409(() => api.publishVersion(id, { effectiveFrom: "2030-01-01", changeNote: "again" }, approver));

    expect(snapshot()).toBe(before);
    expect(store.getSnapshot().auditLog.length).toBe(auditBefore);
  });

  it("an edit that touches nothing is still refused on a published version", () => {
    expect409(() => api.patchVersion("ver_rad114_3", {}, editor));
  });

  it("changing the rules means a new draft; the published source stays byte-for-byte the same", () => {
    const frozen = (id: string) => JSON.stringify({ ...api.getVersionById(id).version, effectiveTo: undefined, updatedAt: undefined });
    const before = frozen("ver_rad114_3");

    const draft = api.createDraft("pol_rad114", { actor: editor });
    expect(draft.versionNumber).toBe(4);
    api.patchVersion(draft.id, { criteria: draft.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, 8) : c)) }, editor);
    expect(frozen("ver_rad114_3")).toBe(before);

    api.publishVersion(draft.id, { effectiveFrom: "2026-12-01", changeNote: "Rev. 4: 8 weeks." }, approver);
    // publishing closes v3's range (the one thing that may change) and nothing else
    expect(api.getVersionById("ver_rad114_3").version.effectiveTo).toBe("2026-11-30");
    expect(frozen("ver_rad114_3")).toBe(before);
    expect(api.getVersionById("ver_rad114_3").version.criteria.find((c) => c.key === "symptom_duration")!.properties[0].value).toBe(6);
  });

  it("the store-level guard rolls back any write that alters a published version", () => {
    const before = publishedFingerprint(store.getSnapshot().versions);
    const tampered = structuredClone(store.getSnapshot().versions);
    expect(changedPublished(before, tampered)).toEqual([]);

    tampered.find((v) => v.id === "ver_rad114_2")!.criteria[0].properties[0].value = 1;
    expect(changedPublished(before, tampered)).toEqual(["ver_rad114_2"]);

    // closing a range or touching updatedAt is allowed
    const closing = structuredClone(store.getSnapshot().versions);
    closing.find((v) => v.id === "ver_rad114_3")!.effectiveTo = "2030-01-01";
    closing.find((v) => v.id === "ver_rad114_3")!.updatedAt = "2030-01-01T00:00:00.000Z";
    expect(changedPublished(before, closing)).toEqual([]);

    // removal counts too
    expect(changedPublished(before, closing.filter((v) => v.id !== "ver_rad114_1"))).toEqual(["ver_rad114_1"]);
  });
});

describe("audit log", () => {
  const log = () => store.getSnapshot().auditLog;

  it("every mutation writes who / what / entity / before / after / when", () => {
    const seen: string[] = [];
    const step = (name: string, fn: () => unknown, expected: { action: string; entityType: string }) => {
      const n = log().length;
      fn();
      const added = log().slice(n);
      expect(added.length, name).toBeGreaterThanOrEqual(1);
      const entry = added[added.length - 1];
      expect(entry, name).toMatchObject(expected);
      expect(entry.actor, name).toBeTruthy();
      expect(entry.entityId, name).toBeTruthy();
      expect(entry).toHaveProperty("before");
      expect(entry).toHaveProperty("after");
      expect(Number.isNaN(Date.parse(entry.timestamp)), name).toBe(false);
      seen.push(entry.action);
      return entry;
    };

    let draftId = "";
    step("createDraft", () => (draftId = api.createDraft("pol_msk207", { actor: editor }).id), { action: "created_draft", entityType: "policy_version" });
    const v = api.getVersionById(draftId).version;
    const edit = step(
      "patchVersion",
      () => api.patchVersion(draftId, { criteria: v.criteria.map((c) => (c.key === "symptom_duration" ? withWeeks(c, 6) : c)) }, editor),
      { action: "edited", entityType: "policy_version" },
    );
    expect(edit.before).toHaveProperty("criteria");
    expect(edit.after).toHaveProperty("criteria");
    step("testVersion", () => api.testVersion(draftId, editor), { action: "test_run", entityType: "policy_version" });
    step("publishVersion", () => api.publishVersion(draftId, { effectiveFrom: "2026-12-01", changeNote: "Rev. 4." }, approver), { action: "published", entityType: "policy_version" });

    let toArchive = "";
    api.createDraft("pol_img330", { actor: editor });
    toArchive = store.getSnapshot().versions.find((x) => x.policyId === "pol_img330" && x.status === "draft")!.id;
    step("archiveVersion", () => api.archiveVersion(toArchive, editor), { action: "archived", entityType: "policy_version" });

    const input: EvaluationInput = { payerId: "payer_federation", planType: "ppo", cptCode: "72148", serviceDate: "2026-11-18", facts: [] };
    let evalId = "";
    step("evaluate", () => (evalId = api.evaluate(input, { patientRef: "p1", orderRef: "o1", actor: "Dana Whitfield" }).id), { action: "evaluated", entityType: "evaluation" });
    expect(log()[log().length - 1].actor).toBe("Dana Whitfield");
    step("rerunEvaluation", () => api.rerunEvaluation(evalId), { action: "evaluated", entityType: "evaluation" });
    step("saveEvaluationAsTestCase", () => api.saveEvaluationAsTestCase(evalId, "Saved", editor), { action: "test_case_saved", entityType: "test_case" });
    step("setTwoPersonRule", () => api.setTwoPersonRule(true, approver), { action: "config_changed", entityType: "config" });
    step("observeSourceHash", () => api.observeSourceHash("fixtures/policies/insurer-policy-excerpts.pdf", "0".repeat(64), "Priya Raman"), { action: "source_observed", entityType: "source_document" });

    expect(new Set(seen).size).toBe(seen.length - 1); // evaluated appears twice, everything else once
  });

  it("writes nothing for a refused or a no-op change", () => {
    const n = log().length;
    expect(() => api.patchVersion("ver_rad114_3", { changeNote: "x" }, editor)).toThrow(ApiError);
    expect(() => api.archiveVersion("ver_rad114_3", editor)).toThrow(ApiError);
    api.setTwoPersonRule(false, editor); // already off
    api.observeSourceHash("fixtures/policies/insurer-policy-excerpts.pdf", SEED_PDF_HASH); // already observed
    expect(log().length).toBe(n);
  });

  it("is append-only history per entity, newest first, and survives a reload", () => {
    const draft = api.createDraft("pol_msk207", { actor: editor });
    api.archiveVersion(draft.id, editor);
    expect(api.getAudit(draft.id).map((a) => a.action)).toEqual(["archived", "created_draft"]);
    const storage = new MemoryStorage();
    const s2 = new RulesStore(storage, buildSeedDb);
    const api2 = createRulesApi(s2, { today: () => clock, now: () => "2026-11-09T12:00:00.000Z" });
    api2.createDraft("pol_msk207", { actor: editor });
    expect(new RulesStore(storage, buildSeedDb).getSnapshot().auditLog.at(-1)!.action).toBe("created_draft");
  });
});

describe("creating and discarding", () => {
  const radDraft = () => api.getPolicy("pol_rad114").versions.find((v) => v.status === "draft");

  it("createPolicy makes the policy, a new payer and an empty draft v1, and audits both", () => {
    const { policy, payer, draft } = api.createPolicy(
      { newPayerName: "Bajoran Health", externalPolicyId: "CT-500", title: "CT of the head", bodySite: "Brain" },
      editor,
    );
    expect(payer).toMatchObject({ name: "Bajoran Health", slug: "bajoran-health" });
    expect(policy).toMatchObject({ externalPolicyId: "CT-500", bodySite: "brain", payerId: payer.id });
    expect(draft).toMatchObject({ versionNumber: 1, status: "draft", derivedStatus: "draft", criteria: [], exceptions: [], effectiveFrom: null, clonedFromVersionId: null });
    expect(draft.applicability.cptCodes).toEqual([]);
    expect(api.listPolicies().find((s) => s.policy.id === policy.id)!.openDraft?.id).toBe(draft.id);
    expect(api.getAudit(policy.id).map((a) => a.action)).toEqual(["created_policy"]);
    expect(api.getAudit(draft.id).map((a) => a.action)).toEqual(["created_draft"]);
    // an empty draft saves, but cannot be published
    expect(api.validateVersion(draft.id).errors.map((e) => e.code)).toEqual(expect.arrayContaining(["criteria.empty", "applicability.cpt.empty"]));
    expect(() => api.publishVersion(draft.id, { effectiveFrom: "2026-12-01", changeNote: "x" }, approver)).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("createPolicy reuses an existing payer, rejects a duplicate policy ID with 409, and missing fields with 422", () => {
    const fed = api.listPayers().find((p) => p.name === "Federation Health")!;
    const made = api.createPolicy({ payerId: fed.id, externalPolicyId: "RAD-200", title: "MRI of the cervical spine", bodySite: "cervical_spine" }, editor);
    expect(made.payer.id).toBe(fed.id);
    expect(api.listPayers()).toHaveLength(3);
    const dup = () => api.createPolicy({ payerId: fed.id, externalPolicyId: "rad-114", title: "Again", bodySite: "knee" }, editor);
    expect(dup).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => api.createPolicy({ payerId: fed.id, externalPolicyId: " ", title: "", bodySite: "knee" }, editor)).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => api.createPolicy({ externalPolicyId: "X-1", title: "T", bodySite: "knee" }, editor)).toThrow(expect.objectContaining({ status: 422 }));
    // refused calls leave no trace
    expect(api.listPolicies()).toHaveLength(4);
  });

  it("discardDraft archives a draft but keeps its history; a policy's only draft takes the policy with it", () => {
    const d = api.createDraft("pol_rad114", { actor: editor, cloneFrom: "ver_rad114_3" });
    expect(api.createDraft.bind(api, "pol_rad114", { actor: editor })).toThrow(expect.objectContaining({ status: 409 }));
    expect(api.discardDraft(d.id, editor)).toEqual({ policyRemoved: false });
    expect(radDraft()).toBeUndefined();
    expect(api.getVersionById(d.id).version.status).toBe("archived");
    expect(api.createDraft("pol_rad114", { actor: editor }).versionNumber).toBe(5); // numbering never reuses

    const { policy, draft } = api.createPolicy({ newPayerName: "Cardassian Union", externalPolicyId: "N-1", title: "Nothing", bodySite: "knee" }, editor);
    expect(api.discardDraft(draft.id, editor)).toEqual({ policyRemoved: true });
    expect(api.listPolicies().some((s) => s.policy.id === policy.id)).toBe(false);
    expect(api.getAudit(draft.id).map((a) => a.action)).toEqual(["archived", "created_draft"]);
  });

  it("discardDraft refuses published versions with 409", () => {
    expect(() => api.discardDraft("ver_rad114_3", editor)).toThrow(expect.objectContaining({ status: 409 }));
    expect(api.getVersionById("ver_rad114_3").version.status).toBe("published");
  });

  it("an excluded source type is ignored by the rule and cannot also be accepted", () => {
    const fact = "conservative_treatment";
    const base = [
      { key: "duration", label: "Duration", value: 6, unit: "weeks", check: { op: "min_weeks" as const, fact } },
      { key: "accepted", label: "Accepted", value: ["pt_note", "clinic_note_treating_provider"], check: { op: "source_in" as const, fact } },
    ];
    const excluded = { key: "excluded", label: "Not accepted", value: ["pt_note"], check: { op: "source_not_in" as const, fact } };
    const facts = [treatment({ modality: "physical_therapy", start: "2026-08-01", end: "2026-10-15", sourceType: "pt_note", response: true })];
    const ctx = { serviceDate: "2026-11-09", cptCode: "72148", planType: "commercial_ppo", bodySite: "lumbar_spine" };
    expect(evaluateProperties(base, facts, ctx).status).toBe("met");
    expect(evaluateProperties([...base, excluded], facts, ctx).status).toBe("not_met");

    const draft = api.createDraft("pol_msk207", { actor: editor });
    const criteria = draft.criteria.map((c) =>
      c.key === "conservative_care" ? { ...c, properties: c.properties.map((p) => (p.key === "excluded_sources" ? { ...p, value: ["pt_note"] } : p)) } : c,
    );
    const { validation } = api.patchVersion(draft.id, { criteria }, editor);
    expect(validation.errors.map((e) => e.code)).toContain("criterion.sources.overlap");
  });
});

describe("version resolution by service date", () => {
  const vnum = (date: string) => api.getVersionFor("pol_rad114", date)?.versionNumber ?? null;

  it("getVersionFor returns the published version in range: day before, day of, day after each boundary", () => {
    // seed: v1 2025-01-01..2025-06-30, v2 2025-07-01..2025-12-31, v3 2026-01-01..
    expect(vnum("2024-12-31")).toBeNull();
    expect(vnum("2025-01-01")).toBe(1);
    expect(vnum("2025-06-30")).toBe(1);
    expect(vnum("2025-07-01")).toBe(2);
    expect(vnum("2025-12-31")).toBe(2);
    expect(vnum("2026-01-01")).toBe(3);
    expect(vnum("2027-06-01")).toBe(3);
    expect(() => api.getVersionFor("nope", "2026-01-01")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("follows a newly published version: the old one ends the day before, never the same day", () => {
    const draft = api.createDraft("pol_rad114", { actor: editor });
    api.publishVersion(draft.id, { effectiveFrom: "2027-03-01", changeNote: "March update." }, approver);
    expect(vnum("2027-02-28")).toBe(3);
    expect(vnum("2027-03-01")).toBe(4);
    expect(vnum("2027-03-02")).toBe(4);
    expect(api.getVersionById("ver_rad114_3").version.effectiveTo).toBe("2027-02-28");
  });

  it("does not resolve a draft, an archived draft, or a version that was never published", () => {
    const draft = api.createDraft("pol_rad114", { actor: editor });
    expect(vnum("2027-01-01")).toBe(3);
    api.discardDraft(draft.id, editor);
    expect(vnum("2027-01-01")).toBe(3);
  });
});

describe("publishing: scheduling, overlap, rollback, recent changes", () => {
  const note = { changeNote: "Update." };

  it("a future date makes the version Scheduled while the old one stays Active, and audits the supersession", () => {
    const draft = api.createDraft("pol_rad114", { actor: editor });
    const published = api.publishVersion(draft.id, { effectiveFrom: "2027-03-01", ...note }, approver);
    expect(published).toMatchObject({ status: "published", derivedStatus: "scheduled", effectiveFrom: "2027-03-01", effectiveTo: null, publishedBy: "App Rover" });
    expect(api.getVersionById("ver_rad114_3").version.derivedStatus).toBe("active");
    const entry = api.getAudit(draft.id)[0];
    expect(entry).toMatchObject({ action: "published", actor: "App Rover" });
    expect(entry.after).toMatchObject({ supersedes: { versionNumber: 3, effectiveToAfter: "2027-02-28" } });
    expect(api.listPolicies().find((s) => s.policy.id === "pol_rad114")!.scheduled?.versionNumber).toBe(4);
  });

  it("today as the date makes it Active at once and supersedes the previous version", () => {
    const draft = api.createDraft("pol_rad114", { actor: editor });
    const published = api.publishVersion(draft.id, { effectiveFrom: clock, ...note }, approver);
    expect(published.derivedStatus).toBe("active");
    const old = api.getVersionById("ver_rad114_3").version;
    expect(old.effectiveTo).toBe("2026-11-08");
    expect(old.derivedStatus).toBe("superseded");
  });

  it("blocks a date that overlaps a scheduled version (422), and the draft stays a draft", () => {
    const first = api.createDraft("pol_rad114", { actor: editor });
    api.publishVersion(first.id, { effectiveFrom: "2027-03-01", ...note }, approver);
    const second = api.createDraft("pol_rad114", { actor: editor });
    for (const date of ["2027-02-01", "2027-03-01"]) {
      const preview = api.previewPublish(second.id, { effectiveFrom: date, changeNote: "x" });
      expect(preview.validation.errors.map((e) => e.code)).toContain("publish.effective.overlap");
      expect(() => api.publishVersion(second.id, { effectiveFrom: date, changeNote: "x" }, approver)).toThrow(expect.objectContaining({ status: 422 }));
    }
    expect(api.getVersionById(second.id).version.status).toBe("draft");
    expect(api.getVersionById(first.id).version.effectiveTo).toBeNull(); // the scheduled version was not cut short
    api.publishVersion(second.id, { effectiveFrom: "2027-03-02", ...note }, approver);
    expect(api.getVersionById(first.id).version.effectiveTo).toBe("2027-03-01");
  });

  it("requires a change note", () => {
    const draft = api.createDraft("pol_rad114", { actor: editor });
    expect(() => api.publishVersion(draft.id, { effectiveFrom: "2027-03-01", changeNote: "  " }, approver)).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("previewPublish reports the diff, the assumption count and a baseline", () => {
    const draft = api.createDraft("pol_msk207", { actor: editor });
    const preview = api.previewPublish(draft.id, { effectiveFrom: "2027-03-01", changeNote: "x" });
    expect(preview.baseline?.versionNumber).toBe(1);
    expect(preview.diff?.identical).toBe(true);
    expect(preview.openAssumptions).toBeGreaterThan(0); // MSK-207 carries an assumption
  });

  it("restoring an old version makes a new draft from it and leaves history alone", () => {
    const before = JSON.stringify(api.getPolicy("pol_rad114").versions.filter((v) => v.status === "published"));
    const draft = api.createDraft("pol_rad114", { actor: editor, cloneFrom: "ver_rad114_1", kind: "rollback" });
    expect(draft).toMatchObject({ versionNumber: 4, status: "draft", clonedFromVersionId: "ver_rad114_1", changeNote: "Rollback to v1." });
    expect(draft.criteria.map((c) => c.key)).toEqual(api.getVersionById("ver_rad114_1").version.criteria.map((c) => c.key));
    expect(api.getAudit(draft.id)[0].action).toBe("rollback");
    expect(JSON.stringify(api.getPolicy("pol_rad114").versions.filter((v) => v.status === "published"))).toBe(before);
    // one draft per policy
    expect(() => api.createDraft("pol_rad114", { actor: editor, cloneFrom: "ver_rad114_2", kind: "rollback" })).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("lists the latest publishes across payers, newest first, capped, each with the version to diff against", () => {
    const recent = api.listRecentPublishes();
    expect(recent.length).toBe(5); // 3 RAD-114 versions + MSK-207 v1 + IMG-330 v1
    const times = recent.map((r) => r.publishedAt);
    expect([...times].sort().reverse()).toEqual(times);
    const rad3 = recent.find((r) => r.policyId === "pol_rad114" && r.versionNumber === 3)!;
    expect(rad3).toMatchObject({ payerName: "Federation Health", previousVersionId: "ver_rad114_2", publishedBy: "Priya Raman" });
    expect(recent.find((r) => r.policyId === "pol_msk207")!.previousVersionId).toBeNull();
    const d = api.createDraft("pol_msk207", { actor: editor });
    api.publishVersion(d.id, { effectiveFrom: "2027-03-01", changeNote: "Newest." }, approver);
    expect(api.listRecentPublishes()[0]).toMatchObject({ policyId: "pol_msk207", versionNumber: 2, changeNote: "Newest.", publishedBy: "App Rover", derivedStatus: "scheduled" });
    expect(api.listRecentPublishes(2)).toHaveLength(2);
  });
});

describe("evaluation traceability", () => {
  const recordMsk = (serviceDate = "2026-11-16", orderRef = "ORD-1") =>
    api.recordEvaluation({
      orderRef,
      patientRef: "HH-1",
      policyId: "pol_msk207",
      cptCode: "73721",
      planType: "commercial_hmo",
      serviceDate,
      evaluatedOn: "2026-11-09",
      results: [
        { criterionKey: "symptom_duration", status: "met", reason: "5 weeks of pain." },
        { criterionKey: "conservative_care", status: "not_met", reason: "No therapy notes." },
      ],
    });

  it("pins the version and copies the criteria onto every evaluation, engine or recorded", () => {
    const seeded = api.getEvaluation("eval_seed_2").evaluation;
    const recorded = recordMsk();
    for (const e of [seeded, recorded]) {
      expect(e.policyVersionId).toBe("ver_msk207_1");
      expect(e.rulesSnapshot?.versionId).toBe("ver_msk207_1");
      expect(e.rulesSnapshot?.criteria.map((c) => c.key)).toEqual(api.getVersionById("ver_msk207_1").version.criteria.map((c) => c.key));
    }
    expect(recorded.origin).toBe("recorded");
    // criteria with no recorded result are unknown, never met
    expect(recorded.criterionResults.filter((r) => r.status === "unknown").length).toBe(recorded.criterionResults.length - 2);
  });

  it("keeps the snapshot readable after the rules change", () => {
    const e = recordMsk();
    publishFerengiSixWeeks("2026-11-09");
    const again = api.getEvaluation(e.id).evaluation;
    expect(weeks(again.rulesSnapshot!.criteria.find((c) => c.key === "symptom_duration")!)).toBe(4);
  });

  it("is current until a newer version applies to the service date", () => {
    const e = recordMsk("2026-12-15");
    expect(api.getStaleness(e.id)).toBeNull();
    // v2 starts after the service date: v1 still governs it
    publishFerengiSixWeeks("2026-12-16");
    expect(api.getStaleness(e.id)).toBeNull();
  });

  it("goes stale once v2 covers the service date, and names the criteria that changed", () => {
    const e = recordMsk("2026-12-15");
    publishFerengiSixWeeks("2026-12-01");
    const s = api.getStaleness(e.id)!;
    expect(s.pinned.versionNumber).toBe(1);
    expect(s.applicable.versionNumber).toBe(2);
    expect(s.affected).toEqual([{ key: "symptom_duration", label: expect.any(String), kind: "changed" }]);
    expect(api.getEvaluation(e.id).staleness?.applicable.versionNumber).toBe(2);
  });

  it("goes stale on the day a version starts, not the day before", () => {
    const e = recordMsk("2026-12-01");
    publishFerengiSixWeeks("2026-12-01");
    expect(api.getStaleness(e.id)).not.toBeNull();
    const before = recordMsk("2026-11-30", "ORD-2");
    expect(api.getStaleness(before.id)).toBeNull();
  });

  it("ignores an older version that applies to an earlier service date", () => {
    publishFerengiSixWeeks("2026-12-01");
    const e = api.recordEvaluation({
      orderRef: "ORD-3", patientRef: "HH-1", policyId: "pol_msk207", cptCode: "73721", planType: "commercial_hmo",
      serviceDate: "2026-11-20", evaluatedOn: "2026-12-02", results: [],
    });
    expect(e.rulesSnapshot?.versionNumber).toBe(2);
    expect(api.getStaleness(e.id)).toBeNull();
  });

  it("re-checks a recorded evaluation: keeps results for unchanged rules, flags the changed one, keeps the old record", () => {
    const old = recordMsk("2026-12-15");
    publishFerengiSixWeeks("2026-12-01");
    const next = api.recheckEvaluation(old.id, "Dana");
    expect(next.id).not.toBe(old.id);
    expect(next.policyVersionId).toBe(api.getStaleness(old.id)!.applicable.id);
    expect(next.rulesSnapshot?.versionNumber).toBe(2);
    const by = (k: string) => next.criterionResults.find((r) => r.criterionKey === k)!;
    expect(by("symptom_duration").status).toBe("needs_review");
    expect(by("symptom_duration").reason).toMatch(/Changed in v2/);
    expect(by("conservative_care").status).toBe("not_met");
    expect(api.getEvaluation(old.id).evaluation.policyVersionId).toBe("ver_msk207_1");
    expect(api.getLatestEvaluationFor("ORD-1")!.id).toBe(next.id);
    expect(api.getStaleness(next.id)).toBeNull();
    expect(api.getAudit(next.id).some((a) => a.action === "evaluated" && a.actor === "Dana")).toBe(true);
  });

  it("re-checks an engine evaluation by replaying its facts under the new version", () => {
    const seeded = api.getEvaluation("eval_seed_2").evaluation;
    publishFerengiSixWeeks("2026-11-09");
    expect(api.getStaleness(seeded.id)).not.toBeNull();
    const next = api.recheckEvaluation(seeded.id, "Dana");
    expect(next.rulesSnapshot?.versionNumber).toBe(2);
    expect(next.input.facts).toEqual(seeded.input.facts);
  });

  it("bulk re-check skips evaluations that are already current", () => {
    const stale = recordMsk("2026-12-15", "ORD-1");
    const current = recordMsk("2026-11-20", "ORD-2");
    publishFerengiSixWeeks("2026-12-01");
    const made = api.recheckEvaluations([stale.id, current.id], "Dana");
    expect(made).toHaveLength(1);
    expect(made[0].orderRef).toBe("ORD-1");
  });
});

// Seed: three payers, three policies, v1 of each, with the insurer's verbatim text as citations.
// Source: fixtures/policies/insurer-policy-excerpts.pdf (pages 1-3). All names and numbers are fictional.

import { ENGINE_VERSION, evaluateOrder } from "@/domain/rules/engine";
import { condition, historyReviewed, study, symptomOnset, treatment } from "@/domain/rules/factBuilders";
import type {
  Criterion,
  Evaluation,
  EvaluationInput,
  EvaluationMode,
  Fact,
  Payer,
  Policy,
  PolicyException,
  PolicyVersion,
  PriorAuthRequirement,
  TestCase,
} from "@/domain/rules/types";
import { SCHEMA_VERSION, type RulesDb } from "./store";

const PDF = "fixtures/policies/insurer-policy-excerpts.pdf";
/** sha256 of fixtures/policies/insurer-policy-excerpts.pdf */
export const SEED_PDF_HASH = "c47f18276a92c124d41dd0c79e31c26c410cd8513197bbda67cf6ca3b4cdcb6b";

export const SEED_AUTHOR = "Seed import";
const SEED_TS = "2025-12-18T15:00:00.000Z";
const SEED_EFFECTIVE = "2026-01-01";

export const PAYERS: Payer[] = [
  { id: "payer_federation", name: "Federation Health", slug: "federation-health" },
  { id: "payer_ferengi", name: "Ferengi Benefit Group", slug: "ferengi-benefit-group" },
  { id: "payer_andorian", name: "Andorian Life", slug: "andorian-life" },
];

export const POLICIES: Policy[] = [
  { id: "pol_rad114", payerId: "payer_federation", externalPolicyId: "RAD-114", title: "MRI of the lumbar spine", bodySite: "lumbar_spine", createdAt: SEED_TS },
  { id: "pol_msk207", payerId: "payer_ferengi", externalPolicyId: "MSK-207", title: "MRI of the knee", bodySite: "knee", createdAt: SEED_TS },
  { id: "pol_img330", payerId: "payer_andorian", externalPolicyId: "IMG-330", title: "MRI of the shoulder", bodySite: "shoulder", createdAt: SEED_TS },
];

interface CritSpec {
  key: string;
  label: string;
  type: string;
  params: Record<string, unknown>;
  section: string;
  excerpt: string;
  note?: string;
  assumption?: boolean;
  mode?: EvaluationMode;
}

function criteria(versionId: string, specs: CritSpec[]): Criterion[] {
  return specs.map((s, i) => ({
    id: `crit_${versionId}_${s.key}`,
    policyVersionId: versionId,
    key: s.key,
    displayLabel: s.label,
    type: s.type,
    params: s.params,
    evaluationMode: s.mode ?? "auto",
    sourceCitation: { section: s.section, excerpt: s.excerpt },
    interpretationNote: s.note ?? null,
    isAssumption: s.assumption ?? false,
    sortOrder: i,
  }));
}

function exception(
  versionId: string,
  e: Omit<PolicyException, "id" | "policyVersionId" | "interpretationNote" | "isAssumption"> & { note?: string; assumption?: boolean },
): PolicyException {
  const { note, assumption, ...rest } = e;
  return { ...rest, id: `exc_${versionId}_${e.key}`, policyVersionId: versionId, interpretationNote: note ?? null, isAssumption: assumption ?? false };
}

function version(
  id: string,
  policyId: string,
  v: Pick<PolicyVersion, "applicability" | "submission" | "criteria" | "exceptions" | "sourceRevisionLabel"> & { page: number },
): PolicyVersion {
  const { page, ...rest } = v;
  return {
    id,
    policyId,
    versionNumber: 1,
    status: "published",
    effectiveFrom: SEED_EFFECTIVE,
    effectiveTo: null,
    sourceDocument: `${PDF}#page=${page}`,
    sourceDocumentHash: SEED_PDF_HASH,
    logic: "ALL",
    changeNote: "Initial import from the insurer's policy document.",
    createdBy: SEED_AUTHOR,
    lastEditedBy: SEED_AUTHOR,
    publishedBy: SEED_AUTHOR,
    publishedAt: SEED_TS,
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
    clonedFromVersionId: null,
    ...rest,
  };
}

/* ------------------------------------------------------------------ Federation Health · RAD-114 */

const V_RAD = "ver_rad114_1";
const rad114 = version(V_RAD, "pol_rad114", {
  page: 1,
  sourceRevisionLabel: "Effective 01/01/2026",
  applicability: { cptCodes: ["72148", "72149", "72158"], planTypes: "all", settings: ["outpatient"] },
  submission: {
    channels: ["api", "portal"],
    requiredAttachments: ["most recent office note", "conservative-treatment documentation"],
    incompleteRequestHandling: "unspecified",
  },
  criteria: criteria(V_RAD, [
    {
      key: "symptom_duration",
      label: "2a. Symptom duration",
      type: "min_duration",
      params: { factType: "symptom_onset", minWeeks: 6 },
      section: "§2a",
      excerpt: "a. Low back pain, with or without radicular symptoms, for 6 weeks or more;",
    },
    {
      key: "conservative_care",
      label: "2b. Conservative treatment",
      type: "evidence_in_window",
      params: {
        factType: "conservative_treatment",
        minWeeks: 6,
        lookbackMonths: 6,
        allowedSourceTypes: ["pt_note", "clinic_note_treating_provider", "pharmacy_record"],
        allowedModalities: ["physical_therapy", "chiropractic", "prescription_medication"],
        requireResponseDocumented: true,
      },
      section: "§2b",
      excerpt:
        "b. 6 weeks or more of conservative treatment in the past 6 months, such as physical therapy, chiropractic care or prescription medication, with documentation of the treatment and the response;",
    },
    {
      key: "prior_xray",
      label: "2c. Plain X-rays",
      type: "required_prior_study",
      params: { studyType: "xray", bodySite: "lumbar_spine" },
      section: "§2c",
      excerpt: "c. Plain X-rays of the lumbar spine, unless a red-flag condition is present;",
    },
    {
      key: "no_recent_mri",
      label: "2d. No recent lumbar MRI",
      type: "no_prior_study_in_window",
      params: { studyType: "mri", bodySite: "lumbar_spine", withinMonths: 12, sameLaterality: false, overrideCondition: "symptoms_materially_changed" },
      section: "§2d",
      excerpt: "d. No lumbar MRI in the past 12 months, unless symptoms have materially changed.",
    },
  ]),
  exceptions: [
    exception(V_RAD, {
      key: "red_flags",
      displayLabel: "3. Red-flag conditions",
      triggers: [
        "cauda_equina_symptoms",
        "progressive_neurological_deficit",
        "suspected_infection",
        "suspected_malignancy_or_cancer_history",
        "significant_trauma",
      ],
      waivesCriterionKeys: ["symptom_duration", "conservative_care", "prior_xray"],
      evaluationMode: "human_review",
      sourceCitation: {
        section: "§3",
        excerpt:
          "3. Red-flag conditions waive 2a to 2c: cauda equina symptoms (bowel or bladder dysfunction, saddle anesthesia), progressive neurological deficit, suspected infection, suspected malignancy or history of cancer, significant trauma.",
      },
    }),
  ],
});

/* ------------------------------------------------------------------ Ferengi Benefit Group · MSK-207 */

const V_MSK = "ver_msk207_1";
const msk207 = version(V_MSK, "pol_msk207", {
  page: 2,
  sourceRevisionLabel: "Rev. 3",
  applicability: { cptCodes: ["73721", "73722", "73723"], planTypes: ["commercial_hmo"], settings: "all" },
  submission: { channels: ["portal"], requiredAttachments: [], incompleteRequestHandling: "deny_resubmit_new" },
  criteria: criteria(V_MSK, [
    {
      key: "symptom_duration",
      label: "1. Symptom duration",
      type: "min_duration",
      params: { factType: "symptom_onset", minWeeks: 4 },
      section: "Criteria (1)",
      excerpt: "(1) knee pain for at least 4 weeks;",
      assumption: true,
      note: "CPT codes cover all lower-extremity joints but criteria are written for the knee only. Hip/ankle MRI requests are flagged as a coverage gap.",
    },
    {
      key: "conservative_care",
      label: "2. Conservative treatment",
      type: "evidence_in_window",
      params: {
        factType: "conservative_treatment",
        minWeeks: 4,
        allowedSourceTypes: ["pt_note", "clinic_note_treating_provider"],
        requireResponseDocumented: false,
      },
      section: "Criteria (2)",
      excerpt:
        "(2) at least 4 weeks of conservative treatment, documented in physical therapy notes or clinic notes from the treating provider. A patient's own report of treatment is not sufficient documentation.",
    },
    {
      key: "prior_xray",
      label: "3. Knee X-ray",
      type: "required_prior_study",
      params: { studyType: "xray", bodySite: "knee", withinMonths: 6 },
      section: "Criteria (3)",
      excerpt: "(3) Knee X-rays within the past 6 months; and",
    },
    {
      key: "no_recent_mri",
      label: "4. No recent knee MRI",
      type: "no_prior_study_in_window",
      params: { studyType: "mri", bodySite: "knee", withinMonths: 12, sameLaterality: true },
      section: "Criteria (4)",
      excerpt: "(4) no knee MRI of the same knee in the past 12 months.",
    },
  ]),
  exceptions: [
    exception(V_MSK, {
      key: "acute_structural",
      displayLabel: "Exceptions",
      triggers: ["suspected_ligament_rupture_with_instability", "locked_knee_unable_to_extend", "suspected_fracture_not_seen_on_xray"],
      waivesCriterionKeys: ["symptom_duration", "conservative_care"],
      evaluationMode: "human_review",
      sourceCitation: {
        section: "Exceptions",
        excerpt:
          "Criteria (1) and (2) do not apply to suspected ligament rupture with instability, locked knee unable to extend, or suspected fracture not seen on X-ray.",
      },
    }),
  ],
});

/* ------------------------------------------------------------------ Andorian Life · IMG-330 */

const V_IMG = "ver_img330_1";
const img330 = version(V_IMG, "pol_img330", {
  page: 3,
  sourceRevisionLabel: null,
  applicability: { cptCodes: ["73221", "73222", "73223"], planTypes: "all", settings: "all" },
  submission: { channels: ["portal"], requiredAttachments: [], incompleteRequestHandling: "unspecified" },
  criteria: criteria(V_IMG, [
    {
      key: "symptom_duration",
      label: "Duration of symptoms",
      type: "min_duration",
      params: { factType: "symptom_onset", minWeeks: 6 },
      section: "Duration of symptoms",
      excerpt: "Duration of symptoms | 6 weeks or more",
    },
    {
      key: "conservative_care",
      label: "Conservative care",
      type: "evidence_in_window",
      params: {
        factType: "conservative_treatment",
        minWeeks: 6,
        allowedSourceTypes: ["pt_note", "injection_record", "clinic_note_treating_provider"],
        requireResponseDocumented: false,
      },
      section: "Conservative care",
      excerpt: "Conservative care | 6 weeks or more, documented (PT notes, injection record or clinic notes)",
    },
    {
      key: "prior_xray",
      label: "Imaging first",
      type: "required_prior_study",
      params: { studyType: "xray", bodySite: "shoulder" },
      section: "Imaging first",
      excerpt: "Imaging first | Shoulder X-ray required",
    },
    {
      key: "no_recent_mri",
      label: "Repeat imaging",
      type: "no_prior_study_in_window",
      params: { studyType: "mri", bodySite: "shoulder", withinMonths: 12, sameLaterality: false },
      section: "Repeat imaging",
      excerpt: "Repeat imaging | Not within 12 months",
      assumption: true,
      note: "Policy does not specify laterality.",
    },
  ]),
  exceptions: [
    exception(V_IMG, {
      key: "red_flags",
      displayLabel: "Waived when",
      triggers: ["trauma_with_weakness", "suspected_full_thickness_rotator_cuff_tear", "dislocation", "suspected_infection", "history_of_cancer"],
      waivesCriterionKeys: ["symptom_duration", "conservative_care", "prior_xray"],
      evaluationMode: "human_review",
      sourceCitation: {
        section: "Waived when",
        excerpt:
          "Waived when | Trauma with weakness, suspected full-thickness rotator cuff tear, dislocation, suspected infection, history of cancer",
      },
      assumption: true,
      note: "Policy says 'Waived when' without listing which requirements are waived. Assumed to match the other payers; repeat-imaging rule not waived. Confirm with payer.",
    }),
  ],
});

/* ------------------------------------------------------------------ Test cases (golden) */

const SERVICE = "2026-11-18";
let n = 0;
const tc = (policyId: string, slug: string, name: string, description: string, input: TestCase["input"], expected: TestCase["expected"]): TestCase => ({
  id: `tc_${slug}_${++n}`,
  policyId,
  name,
  description,
  input,
  expected,
});

/** Clean lumbar facts: 9 weeks of pain, 7 weeks of PT + naproxen with response, X-ray, imaging history reviewed. */
const radFacts = (): Fact[] => [
  symptomOnset("2026-09-14", { excerpt: "Low back pain radiating down R leg x 8 weeks." }),
  treatment({ modality: "physical_therapy", start: "2026-09-14", end: "2026-10-26", response: true, excerpt: "PT discharge summary: 12 visits over 6 weeks; partial relief." }),
  treatment({ modality: "prescription_medication", start: "2026-10-05", end: "2026-11-02", response: true, sourceType: "pharmacy_record", excerpt: "Naproxen 500 mg BID, 4 weeks; minimal relief." }),
  study({ studyType: "xray", bodySite: "lumbar_spine", date: "2026-10-02", excerpt: "XR lumbar spine 10/02: mild L5-S1 disc space narrowing." }),
  historyReviewed("2026-11-09", { excerpt: "Imaging history: no prior lumbar MRI." }),
];
const without = (facts: Fact[], type: string) => facts.filter((f) => f.type !== type);
const radBase = { planType: "commercial_ppo", cptCode: "72148", serviceDate: SERVICE, setting: "outpatient" as const };

const TEST_CASES: TestCase[] = [
  tc("pol_rad114", "rad114", "Clean approval", "Every criterion documented from accepted sources.", { ...radBase, facts: radFacts() }, {
    overall: "approve_ready",
    criteria: { symptom_duration: "met", conservative_care: "met", prior_xray: "met", no_recent_mri: "met" },
  }),
  tc("pol_rad114", "rad114", "Missing X-ray", "No lumbar X-ray on file; everything else is documented.", { ...radBase, facts: without(radFacts(), "imaging_study") }, {
    overall: "missing_info",
    criteria: { prior_xray: "unknown" },
  }),
  tc(
    "pol_rad114",
    "rad114",
    "Red flag waives 2a to 2c",
    "Cauda equina symptoms documented; no conservative care or X-ray yet. 2d is not waived and passes.",
    { ...radBase, facts: [condition("cauda_equina_symptoms", "2026-11-17", { excerpt: "New saddle anesthesia and urinary retention." }), historyReviewed("2026-11-17")] },
    {
      overall: "needs_review",
      criteria: { symptom_duration: "waived", conservative_care: "waived", prior_xray: "waived", no_recent_mri: "met" },
    },
  ),
  tc(
    "pol_rad114",
    "rad114",
    "Repeat MRI 4 months ago, even with a red flag",
    "The red flag waives 2a to 2c but not 2d, so a lumbar MRI from 4 months ago still fails.",
    {
      ...radBase,
      facts: [
        condition("progressive_neurological_deficit", "2026-11-17"),
        study({ studyType: "mri", bodySite: "lumbar_spine", date: "2026-07-18", excerpt: "MRI lumbar spine 07/18: no acute findings." }),
        historyReviewed("2026-11-17"),
      ],
    },
    {
      overall: "not_eligible",
      criteria: { symptom_duration: "waived", conservative_care: "waived", prior_xray: "waived", no_recent_mri: "not_met" },
    },
  ),

  ...(() => {
    const base = { planType: "commercial_hmo", cptCode: "73721", serviceDate: SERVICE, laterality: "left" as const };
    const facts = (): Fact[] => [
      symptomOnset("2026-10-01", { excerpt: "Left knee pain x 7 weeks." }),
      treatment({ modality: "physical_therapy", start: "2026-10-01", end: "2026-11-05", response: true, excerpt: "PT 5 weeks, 10 visits." }),
      study({ studyType: "xray", bodySite: "knee", date: "2026-10-20", laterality: "left", excerpt: "XR left knee 10/20: no fracture." }),
      historyReviewed("2026-11-10", { excerpt: "No prior knee MRI." }),
    ];
    return [
      tc("pol_msk207", "msk207", "Clean approval", "Left knee, HMO; PT note, X-ray and imaging history all on file.", { ...base, facts: facts() }, {
        overall: "approve_ready",
        criteria: { symptom_duration: "met", conservative_care: "met", prior_xray: "met", no_recent_mri: "met" },
        submissionBlocked: false,
      }),
      tc("pol_msk207", "msk207", "Missing X-ray blocks submission", "No knee X-ray. This payer denies incomplete requests and will not amend them.", { ...base, facts: without(facts(), "imaging_study") }, {
        overall: "missing_info",
        criteria: { prior_xray: "unknown" },
        submissionBlocked: true,
      }),
      tc(
        "pol_msk207",
        "msk207",
        "Locked knee waives criteria 1 and 2",
        "Locked knee unable to extend. Duration and conservative care are waived; X-ray and imaging history still required.",
        {
          ...base,
          facts: [
            condition("locked_knee_unable_to_extend", "2026-11-16", { excerpt: "Unable to fully extend L knee; mechanical block." }),
            study({ studyType: "xray", bodySite: "knee", date: "2026-11-16", laterality: "left" }),
            historyReviewed("2026-11-16"),
          ],
        },
        { overall: "needs_review", criteria: { symptom_duration: "waived", conservative_care: "waived", prior_xray: "met", no_recent_mri: "met" } },
      ),
      tc(
        "pol_msk207",
        "msk207",
        "Repeat MRI of the same knee",
        "Left knee MRI 4 months ago.",
        { ...base, facts: [...facts(), study({ studyType: "mri", bodySite: "knee", date: "2026-07-20", laterality: "left", excerpt: "MRI left knee 07/20." })] },
        { overall: "not_eligible", criteria: { no_recent_mri: "not_met" } },
      ),
      tc(
        "pol_msk207",
        "msk207",
        "Patient-reported treatment only",
        "The only evidence of conservative care is the patient's own report, which this policy does not accept.",
        {
          ...base,
          facts: [
            ...without(facts(), "conservative_treatment"),
            treatment({ modality: "physical_therapy", start: "2026-10-01", end: "2026-11-05", sourceType: "patient_reported", excerpt: "Patient states she did PT for 5 weeks." }),
          ],
        },
        { overall: "not_eligible", criteria: { conservative_care: "not_met" } },
      ),
    ];
  })(),

  ...(() => {
    const base = { planType: "commercial_ppo", cptCode: "73221", serviceDate: SERVICE, laterality: "right" as const };
    const facts = (): Fact[] => [
      symptomOnset("2026-09-21", { excerpt: "Right shoulder pain x 8 weeks." }),
      treatment({ modality: "physical_therapy", start: "2026-09-28", end: "2026-11-09", response: true, excerpt: "PT 6 weeks." }),
      study({ studyType: "xray", bodySite: "shoulder", date: "2026-10-05", laterality: "right", excerpt: "XR right shoulder 10/05." }),
      historyReviewed("2026-11-12", { excerpt: "No prior shoulder MRI." }),
    ];
    return [
      tc("pol_img330", "img330", "Clean approval", "All four requirements documented.", { ...base, facts: facts() }, {
        overall: "approve_ready",
        criteria: { symptom_duration: "met", conservative_care: "met", prior_xray: "met", no_recent_mri: "met" },
      }),
      tc("pol_img330", "img330", "Missing conservative care documentation", "No treatment records on file.", { ...base, facts: without(facts(), "conservative_treatment") }, {
        overall: "missing_info",
        criteria: { conservative_care: "unknown" },
      }),
      tc(
        "pol_img330",
        "img330",
        "Dislocation waives duration, conservative care and X-ray",
        "Waiver scope is an assumption for this payer; repeat imaging is not waived.",
        { ...base, facts: [condition("dislocation", "2026-11-17", { excerpt: "Anterior dislocation reduced in ED." }), historyReviewed("2026-11-17")] },
        { overall: "needs_review", criteria: { symptom_duration: "waived", conservative_care: "waived", prior_xray: "waived", no_recent_mri: "met" } },
      ),
      tc(
        "pol_img330",
        "img330",
        "Repeat MRI (other shoulder still counts)",
        "Policy does not specify laterality, so a left-shoulder MRI blocks a right-shoulder request (assumption).",
        { ...base, facts: [...facts(), study({ studyType: "mri", bodySite: "shoulder", date: "2026-06-02", laterality: "left", excerpt: "MRI left shoulder 06/02." })] },
        { overall: "not_eligible", criteria: { no_recent_mri: "not_met" } },
      ),
      tc(
        "pol_img330",
        "img330",
        "Patient-reported care backed by a clinic note",
        "The patient's own report is ignored, but the treating provider's clinic note documents 6 weeks of care, which this policy accepts.",
        {
          ...base,
          facts: [
            ...without(facts(), "conservative_treatment"),
            treatment({ modality: "physical_therapy", start: "2026-09-28", end: "2026-11-09", sourceType: "patient_reported", excerpt: "Patient says she did exercises at home for 6 weeks." }),
            treatment({ modality: "physical_therapy", start: "2026-09-28", end: "2026-11-09", sourceType: "clinic_note_treating_provider", response: true, excerpt: "Progress note 11/09: completed 6 weeks of PT, modest improvement." }),
          ],
        },
        { overall: "approve_ready", criteria: { conservative_care: "met" } },
      ),
    ];
  })(),
];

/* ------------------------------------------------------------------ Prior-auth CPT list (drives the gap panel) */

/** Demo data: CPT codes each payer is known to require prior auth for. Entries with no criteria show up as gaps. */
const PRIOR_AUTH_REQUIREMENTS: PriorAuthRequirement[] = [
  ...["72148", "72149", "72158"].map((c) => ({ payerId: "payer_federation", cptCode: c, description: "MRI lumbar spine" })),
  { payerId: "payer_federation", cptCode: "72141", description: "MRI cervical spine w/o contrast" },
  ...["73721", "73722", "73723"].map((c) => ({ payerId: "payer_ferengi", cptCode: c, description: "MRI lower-extremity joint" })),
  { payerId: "payer_ferengi", cptCode: "73718", description: "MRI lower extremity (non-joint) w/o contrast" },
  ...["73221", "73222", "73223"].map((c) => ({ payerId: "payer_andorian", cptCode: c, description: "MRI upper-extremity joint" })),
  { payerId: "payer_andorian", cptCode: "73218", description: "MRI upper extremity (non-joint) w/o contrast" },
];

/* ------------------------------------------------------------------ Build */

export function buildSeedDb(): RulesDb {
  const versions = [rad114, msk207, img330];
  const db: RulesDb = {
    schemaVersion: SCHEMA_VERSION,
    seq: 1000,
    payers: PAYERS,
    policies: POLICIES,
    versions,
    testCases: TEST_CASES,
    evaluations: [],
    auditLog: versions.map((v, i) => ({
      id: `audit_seed_${i + 1}`,
      actor: SEED_AUTHOR,
      action: "published" as const,
      entityType: "policy_version" as const,
      entityId: v.id,
      before: null,
      after: { versionNumber: 1, effectiveFrom: SEED_EFFECTIVE, changeNote: v.changeNote },
      timestamp: SEED_TS,
    })),
    priorAuthRequirements: PRIOR_AUTH_REQUIREMENTS,
    observedSourceHashes: { [PDF]: SEED_PDF_HASH },
    config: { twoPersonRule: false },
  };

  // A few evaluations from the golden cases so the Usage tab and trace view have something to show.
  const pick = (policyId: string, name: string) => TEST_CASES.find((t) => t.policyId === policyId && t.name === name)!;
  const samples: Array<[TestCase, string, string]> = [
    [pick("pol_rad114", "Clean approval"), "HH-0017011", "ORD-58213"],
    [pick("pol_msk207", "Clean approval"), "HH-0017022", "ORD-58301"],
    [pick("pol_msk207", "Missing X-ray blocks submission"), "HH-0017023", "ORD-58307"],
    [pick("pol_img330", "Clean approval"), "HH-0017033", "ORD-58340"],
  ];
  samples.forEach(([t, patientRef, orderRef], i) => {
    const policy = POLICIES.find((p) => p.id === t.policyId)!;
    const input: EvaluationInput = { payerId: policy.payerId, ...t.input };
    const { outcome, policyVersionId } = evaluateOrder(db, input);
    const evaluation: Evaluation = {
      id: `eval_seed_${i + 1}`,
      patientRef,
      orderRef,
      serviceDate: input.serviceDate,
      cptCode: input.cptCode,
      planType: input.planType,
      payerId: input.payerId,
      policyVersionId,
      input,
      engineVersion: ENGINE_VERSION,
      createdAt: `2026-11-0${i + 2}T14:00:00.000Z`,
      ...outcome,
    };
    db.evaluations.push(evaluation);
  });
  return db;
}

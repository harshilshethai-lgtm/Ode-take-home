// Seed: three payers, three policies (RAD-114 at v3, the others at v1), with the insurer's verbatim text as citations.
// Source: fixtures/policies/insurer-policy-excerpts.pdf (pages 1-3). All names and numbers are fictional.

import { ENGINE_VERSION, evaluateOrder } from "@/domain/rules/engine";
import { condition, historyReviewed, study, symptomOnset, treatment } from "@/domain/rules/factBuilders";
import type {
  Criterion,
  Evaluation,
  EvaluationInput,
  EvaluationMode,
  FailureType,
  Fact,
  Payer,
  Policy,
  PolicyException,
  PolicyVersion,
  PriorAuthRequirement,
  Property,
  TestCase,
} from "@/domain/rules/types";
import { POLICY_PROPERTY } from "@/domain/rules/policyProperties";
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
  /** The insurer's own reference, as printed. */
  ref: string;
  label: string;
  excerpt: string;
  fail: FailureType;
  properties: Property[];
  mode?: EvaluationMode;
}

function criteria(versionId: string, specs: CritSpec[]): Criterion[] {
  return specs.map((s, i) => ({
    id: `crit_${versionId}_${s.key}`,
    policyVersionId: versionId,
    key: s.key,
    ref: s.ref,
    displayLabel: s.label,
    properties: s.properties,
    evaluationMode: s.mode ?? "auto",
    failureType: s.fail,
    excerpt: s.excerpt,
    sortOrder: i,
  }));
}

function exception(versionId: string, e: Omit<PolicyException, "id" | "policyVersionId" | "assumption"> & { assumption?: string }): PolicyException {
  const { assumption, ...rest } = e;
  return { ...rest, id: `exc_${versionId}_${e.key}`, policyVersionId: versionId, assumption: assumption ?? null };
}

function version(
  id: string,
  policyId: string,
  v: Pick<PolicyVersion, "applicability" | "properties" | "criteria" | "exceptions" | "sourceRevisionLabel"> & { page: number; versionNumber?: number },
): PolicyVersion {
  const { page, versionNumber = 1, ...rest } = v;
  return {
    id,
    policyId,
    versionNumber,
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

/* ------------------------------------------------------------------ Property builders */

const duration = (fact: string, n: number): Property => ({ key: "duration", label: "Duration", value: n, unit: "weeks", check: { op: "min_weeks", fact } });
const lookback = (fact: string, n: number): Property => ({ key: "lookback", label: "Lookback", value: n, unit: "months", check: { op: "within_months", fact } });
const required = (fact: string, key: string, label: string, value: string): Property => ({ key, label, value, check: { op: "present", fact } });
const none = (fact: string, label: string): Property => ({ key: "prior_study", label, value: "None", check: { op: "absent", fact } });
const accepts = (sources: string[]): Property => ({ key: "accepted_sources", label: "Accepted documentation", value: sources, check: { op: "source_in", fact: "conservative_treatment" } });
const list = (key: string, label: string, value: string[]): Property => ({ key, label, value });

/* ------------------------------------------------------------------ Federation Health · RAD-114 */

/**
 * Three published versions, so the history view has something real to show:
 *  v1  Jan 2025  no X-ray criterion; conservative care within 3 months
 *  v2  Jul 2025  adds "X-rays first" (so "No MRI" moves from 2c to 2d)
 *  v3  Jan 2026  conservative care lookback widened from 3 to 6 months (current)
 */
interface RadSpec {
  number: 1 | 2 | 3;
  effectiveFrom: string;
  effectiveTo: string | null;
  revision: string;
  lookbackMonths: 3 | 6;
  withXray: boolean;
  changeNote: string;
  publishedBy: string;
  publishedAt: string;
}

const RAD_SPECS: RadSpec[] = [
  {
    number: 1,
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-06-30",
    revision: "Effective 01/01/2025",
    lookbackMonths: 3,
    withXray: false,
    changeNote: "Initial import of Federation Health RAD-114.",
    publishedBy: "Priya Raman",
    publishedAt: "2024-12-16T17:20:00.000Z",
  },
  {
    number: 2,
    effectiveFrom: "2025-07-01",
    effectiveTo: "2025-12-31",
    revision: "Effective 07/01/2025",
    lookbackMonths: 3,
    withXray: true,
    changeNote: "Insurer added plain X-rays as a criterion.",
    publishedBy: "Marcus Lee",
    publishedAt: "2025-06-18T16:05:00.000Z",
  },
  {
    number: 3,
    effectiveFrom: SEED_EFFECTIVE,
    effectiveTo: null,
    revision: "Effective 01/01/2026",
    lookbackMonths: 6,
    withXray: true,
    changeNote: "Conservative care lookback widened from 3 to 6 months.",
    publishedBy: "Priya Raman",
    publishedAt: SEED_TS,
  },
];

const radId = (n: number) => `ver_rad114_${n}`;

function radVersion(spec: RadSpec): PolicyVersion {
  const id = radId(spec.number);
  const mo = spec.lookbackMonths;
  // Without the X-ray criterion, "No MRI" was the third item.
  const mriRef = spec.withXray ? "2d" : "2c";
  const specs: CritSpec[] = [
    {
      key: "symptom_duration",
      ref: "2a",
      fail: "clinical",
      label: "Symptoms ≥ 6 wks",
      excerpt: "a. Low back pain, with or without radicular symptoms, for 6 weeks or more;",
      properties: [duration("symptom_onset", 6)],
    },
    {
      key: "conservative_care",
      ref: "2b",
      fail: "fixable",
      label: "Conservative care ≥ 6 wks",
      excerpt: `b. 6 weeks or more of conservative treatment in the past ${mo} months, such as physical therapy, chiropractic care or prescription medication, with documentation of the treatment and the response;`,
      properties: [
        duration("conservative_treatment", 6),
        lookback("conservative_treatment", mo),
        required("treatment_response", "response", "Response documented", "Required"),
      ],
    },
    ...(spec.withXray
      ? [
          {
            key: "prior_xray",
            ref: "2c",
            fail: "fixable" as const,
            label: "X-rays first",
            excerpt: "c. Plain X-rays of the lumbar spine, unless a red-flag condition is present;",
            properties: [required("xray", "study", "Imaging", "Plain X-ray of the lumbar spine")],
          },
        ]
      : []),
    {
      key: "no_recent_mri",
      ref: mriRef,
      fail: "clinical",
      label: "No MRI in 12 mo",
      excerpt: `${spec.withXray ? "d" : "c"}. No lumbar MRI in the past 12 months, unless symptoms have materially changed.`,
      properties: [none("mri", "Prior lumbar MRI"), lookback("mri", 12)],
    },
  ];
  const waives = spec.withXray ? ["symptom_duration", "conservative_care", "prior_xray"] : ["symptom_duration", "conservative_care"];
  const v = version(id, "pol_rad114", {
    page: 1,
    versionNumber: spec.number,
    sourceRevisionLabel: spec.revision,
    applicability: { cptCodes: ["72148", "72149", "72158"], settings: ["outpatient"] },
    properties: [
      list(POLICY_PROPERTY.channels, "Submit via", ["api", "portal"]),
      list(POLICY_PROPERTY.attachments, "Attach", ["Most recent office note", "Documentation of conservative treatment"]),
    ],
    criteria: criteria(id, specs),
    exceptions: [
      exception(id, {
        key: "red_flags",
        ref: "3",
        displayLabel: "Red flags",
        triggers: [
          "cauda_equina_symptoms",
          "progressive_neurological_deficit",
          "suspected_infection",
          "suspected_malignancy_or_cancer_history",
          "significant_trauma",
        ],
        waivesCriterionKeys: waives,
        evaluationMode: "human_review",
        excerpt: `3. Red-flag conditions waive ${spec.withXray ? "2a to 2c" : "2a and 2b"}: cauda equina symptoms (bowel or bladder dysfunction, saddle anesthesia), progressive neurological deficit, suspected infection, suspected malignancy or history of cancer, significant trauma.`,
      }),
      exception(id, {
        key: "symptoms_changed",
        ref: mriRef,
        displayLabel: "Symptoms changed",
        triggers: ["symptoms_materially_changed"],
        waivesCriterionKeys: ["no_recent_mri"],
        evaluationMode: "human_review",
        excerpt: "unless symptoms have materially changed.",
      }),
    ],
  });
  return {
    ...v,
    effectiveFrom: spec.effectiveFrom,
    effectiveTo: spec.effectiveTo,
    changeNote: spec.changeNote,
    createdBy: spec.publishedBy,
    lastEditedBy: spec.publishedBy,
    publishedBy: spec.publishedBy,
    publishedAt: spec.publishedAt,
    createdAt: spec.publishedAt,
    updatedAt: spec.publishedAt,
    clonedFromVersionId: spec.number > 1 ? radId(spec.number - 1) : null,
    // Only the current revision of the insurer's PDF is in the fixtures.
    ...(spec.number < 3 ? { sourceDocument: null, sourceDocumentHash: null } : {}),
  };
}

const radVersions = RAD_SPECS.map(radVersion);

/* ------------------------------------------------------------------ Ferengi Benefit Group · MSK-207 */

const V_MSK = "ver_msk207_1";
const msk207 = version(V_MSK, "pol_msk207", {
  page: 2,
  sourceRevisionLabel: "Rev. 3",
  applicability: { cptCodes: ["73721", "73722", "73723"], settings: "all" },
  properties: [
    list(POLICY_PROPERTY.planTypes, "Plans", ["commercial_hmo"]),
    {
      key: "joint",
      label: "Joint",
      value: "Knee",
      assumption: "CPT 73721 to 73723 cover every lower-extremity joint, but the criteria are written for the knee only.",
    },
    list(POLICY_PROPERTY.channels, "Submit via", ["portal"]),
    { key: POLICY_PROPERTY.incompleteRequests, label: "Incomplete requests", value: "deny_resubmit_new" },
  ],
  criteria: criteria(V_MSK, [
    {
      key: "symptom_duration",
      ref: "(1)",
      fail: "clinical",
      label: "Knee pain ≥ 4 wks",
      excerpt: "(1) knee pain for at least 4 weeks;",
      properties: [duration("symptom_onset", 4)],
    },
    {
      key: "conservative_care",
      ref: "(2)",
      fail: "fixable",
      label: "Conservative care ≥ 4 wks",
      excerpt:
        "(2) at least 4 weeks of conservative treatment, documented in physical therapy notes or clinic notes from the treating provider. A patient's own report of treatment is not sufficient documentation.",
      properties: [
        duration("conservative_treatment", 4),
        accepts(["pt_note", "clinic_note_treating_provider"]),
        { key: "excluded_sources", label: "Not accepted", value: ["patient_reported"], check: { op: "source_not_in", fact: "conservative_treatment" } },
      ],
    },
    {
      key: "prior_xray",
      ref: "(3)",
      fail: "fixable",
      label: "Knee X-ray within 6 mo",
      excerpt: "(3) Knee X-rays within the past 6 months; and",
      properties: [required("xray", "study", "Imaging", "Knee X-ray"), lookback("xray", 6)],
    },
    {
      key: "no_recent_mri",
      ref: "(4)",
      fail: "clinical",
      label: "No MRI of same knee in 12 mo",
      excerpt: "(4) no knee MRI of the same knee in the past 12 months.",
      properties: [none("mri", "Prior knee MRI"), lookback("mri", 12), { key: "same_side", label: "Same knee", value: true, check: { op: "same_side", fact: "mri" } }],
    },
  ]),
  exceptions: [
    exception(V_MSK, {
      key: "acute_structural",
      ref: "Exceptions",
      displayLabel: "Acute findings",
      triggers: ["suspected_ligament_rupture_with_instability", "locked_knee_unable_to_extend", "suspected_fracture_not_seen_on_xray"],
      waivesCriterionKeys: ["symptom_duration", "conservative_care"],
      evaluationMode: "human_review",
      excerpt:
        "Criteria (1) and (2) do not apply to suspected ligament rupture with instability, locked knee unable to extend, or suspected fracture not seen on X-ray.",
    }),
  ],
});

/* ------------------------------------------------------------------ Andorian Life · IMG-330 */

const V_IMG = "ver_img330_1";
const img330 = version(V_IMG, "pol_img330", {
  page: 3,
  sourceRevisionLabel: null,
  applicability: { cptCodes: ["73221", "73222", "73223"], settings: "all" },
  properties: [list(POLICY_PROPERTY.channels, "Submit via", ["portal"])],
  criteria: criteria(V_IMG, [
    {
      key: "symptom_duration",
      ref: "Duration of symptoms",
      fail: "clinical",
      label: "Symptoms ≥ 6 wks",
      excerpt: "Duration of symptoms | 6 weeks or more",
      properties: [duration("symptom_onset", 6)],
    },
    {
      key: "conservative_care",
      ref: "Conservative care",
      fail: "fixable",
      label: "Conservative care ≥ 6 wks",
      excerpt: "Conservative care | 6 weeks or more, documented (PT notes, injection record or clinic notes)",
      properties: [duration("conservative_treatment", 6), accepts(["pt_note", "injection_record", "clinic_note_treating_provider"])],
    },
    {
      key: "prior_xray",
      ref: "Imaging first",
      fail: "fixable",
      label: "Shoulder X-ray",
      excerpt: "Imaging first | Shoulder X-ray required",
      properties: [required("xray", "study", "Imaging", "Shoulder X-ray")],
    },
    {
      key: "no_recent_mri",
      ref: "Repeat imaging",
      fail: "clinical",
      label: "No MRI in 12 mo",
      excerpt: "Repeat imaging | Not within 12 months",
      properties: [
        { ...none("mri", "Prior shoulder MRI"), assumption: "The table says \"repeat imaging\"; read as a repeat shoulder MRI." },
        lookback("mri", 12),
        {
          key: "same_side",
          label: "Same shoulder only",
          value: false,
          check: { op: "same_side", fact: "mri" },
          assumption: "The policy does not say which shoulder, so an MRI of either one counts.",
        },
      ],
    },
  ]),
  exceptions: [
    exception(V_IMG, {
      key: "red_flags",
      ref: "Waived when",
      displayLabel: "Red flags",
      triggers: ["trauma_with_weakness", "suspected_full_thickness_rotator_cuff_tear", "dislocation", "suspected_infection", "history_of_cancer"],
      waivesCriterionKeys: ["symptom_duration", "conservative_care", "prior_xray"],
      evaluationMode: "human_review",
      excerpt:
        "Waived when | Trauma with weakness, suspected full-thickness rotator cuff tear, dislocation, suspected infection, history of cancer",
      assumption: "The table does not say which rows are waived. Assumed duration, conservative care and X-ray; repeat imaging is not waived.",
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
  const versions = [...radVersions, msk207, img330];
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
      actor: v.publishedBy ?? SEED_AUTHOR,
      action: "published" as const,
      entityType: "policy_version" as const,
      entityId: v.id,
      before: null,
      after: { versionNumber: v.versionNumber, effectiveFrom: v.effectiveFrom, changeNote: v.changeNote },
      timestamp: v.publishedAt ?? SEED_TS,
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

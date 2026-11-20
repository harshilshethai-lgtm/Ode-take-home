import { bucketRun, type BucketInput } from "./bucket";
import type { EvaluatingInput } from "./decision";
import { AuthState, createOrder, readOrder, transitionOrder } from "./store";
import type { ApprovalInput, Channel, CriterionResult, OrderStatus, ReasonCode } from "./types";

export interface RuleLookupInput {
  insurer: string | null;
  plan: string | null;
  cpt: string | null;
  setting: string | null;
}

export interface RuleLookupResult {
  approvalRequired: boolean;
  policyId: string | null;
  why: string | null;
  /** Null when approval is required but this insurer and study have no criteria. */
  criteria: CriterionResult[] | null;
}

/** Used until a payer rule is published. Approval is required and nothing is borrowed from another payer. */
export function stubRuleEngine(input: RuleLookupInput): RuleLookupResult {
  return {
    approvalRequired: true,
    policyId: null,
    why: null,
    criteria: null,
    ...(input.insurer ? {} : {}),
  };
}

export interface CaseFixture {
  caseNumber: number;
  name: string;
  expected: OrderStatus;
  expectedReason: ReasonCode | null;
  /** Urgent priority. The reason stays INITIAL_REQUEST. */
  urgent?: boolean;
  channel: Channel | null;
  source: string;
  receivedAt: string;
  pageCount: number;
  insurer: string;
  cpt: string;
  preprocessing?: { allPagesBlank?: boolean; identityAndOrderUnreadable?: boolean; unreadableFields?: string; faxSender?: string; faxNumber?: string };
  matching?: { ma1?: boolean; ma2?: boolean; ma3?: boolean; name?: string; dob?: string; detail?: string };
  coverage?: { cv1?: boolean; detail?: string; existingApproval?: ApprovalInput };
  approval?: { required: boolean; hasCriteria: boolean; policyId: string; why?: string; policyReference?: string };
  outsideRecord?: string;
  evaluating?: EvaluatingInput;
}

const met = (id: string, label: string): CriterionResult => ({
  criterionId: id,
  label,
  result: "MET",
  failureClass: null,
  confidence: 0.96,
  evidence: { documentId: "packet", page: 1, quote: label },
});

const waived = (id: string, label: string): CriterionResult => ({ ...met(id, label), result: "WAIVED" });
const exceptionMet = (id: string, label: string): CriterionResult => ({ ...met(id, label), result: "EXCEPTION_MET" });

const clinical = (id: string, label: string, quote: string): CriterionResult => ({
  criterionId: id,
  label,
  result: "NOT_MET",
  failureClass: "clinical",
  confidence: 0.95,
  evidence: { documentId: "packet", page: 1, quote },
});

const unclear = (id: string, label: string): CriterionResult => ({
  criterionId: id,
  label,
  result: "UNCLEAR",
  failureClass: "documents",
  confidence: 0.42,
  evidence: null,
});

const EXPECTED: Record<number, { status: OrderStatus; reason: ReasonCode | null; urgent?: boolean }> = {
  1: { status: "SUBMITTED", reason: "INITIAL_REQUEST" },
  2: { status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS" },
  3: { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET" },
  4: { status: "SUBMITTED", reason: "INITIAL_REQUEST", urgent: true },
  5: { status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD" },
  6: { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET" },
  7: { status: "SUBMITTED", reason: "INITIAL_REQUEST" },
  8: { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET" },
  9: { status: "SUBMITTED", reason: "INITIAL_REQUEST" },
  10: { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET" },
  11: { status: "NOT_REQUIRED", reason: "NOT_ON_PA_LIST" },
  12: { status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS" },
  13: { status: "NEEDS_ADMIN_REVIEW", reason: "UNREADABLE_DOCUMENT" },
  14: { status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD" },
  15: { status: "NEEDS_ADMIN_REVIEW", reason: "WRONG_PATIENT_PAGE" },
  16: { status: "APPROVED", reason: "LINKED_EXISTING" },
  17: { status: "NEEDS_ADMIN_REVIEW", reason: "SIDE_MISMATCH" },
  18: { status: "NEEDS_ADMIN_REVIEW", reason: "INSURER_MISMATCH" },
  19: { status: "NEEDS_CLINICAL_REVIEW", reason: "RULE_GAP" },
  20: { status: "NEEDS_ADMIN_REVIEW", reason: "UNREADABLE_DOCUMENT" },
  21: { status: "NOT_REQUIRED", reason: "SETTING_EXEMPT" },
  22: { status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD" },
  23: { status: "SUBMITTED", reason: "INITIAL_REQUEST", urgent: true },
};

function passed(
  partial: Omit<Partial<CaseFixture>, "expected" | "expectedReason"> & Pick<CaseFixture, "caseNumber" | "name"> & { expected?: string },
): CaseFixture {
  const placement = EXPECTED[partial.caseNumber];
  const { expected: _old, ...rest } = partial;
  return {
    channel: "api",
    source: "Epic",
    receivedAt: "2026-11-09T15:00:00",
    pageCount: 4,
    insurer: "Federation Health",
    cpt: "72148",
    preprocessing: {},
    matching: {},
    coverage: { cv1: true },
    approval: { required: true, hasCriteria: true, policyId: "RAD-114" },
    ...rest,
    expected: placement.status,
    expectedReason: placement.reason,
    urgent: placement.urgent,
  };
}

const ready = (criteria: CriterionResult[]): EvaluatingInput => ({ criteria, confidenceThreshold: 0.85 });

/** The 23 library cases, run until the status before the insurer responds. */
export const CASE_FIXTURES: CaseFixture[] = [
  passed({ caseNumber: 1, name: "Kirk", expected: "READY_TO_SUBMIT", evaluating: ready([met("2a", "8 weeks of pain"), met("2b", "12 PT visits"), met("2c", "X-ray 10/02"), met("2d", "No prior lumbar MRI")]) }),
  passed({
    caseNumber: 2,
    name: "Scott",
    expected: "AWAITING_DOCUMENTS",
    channel: "portal",
    insurer: "Ferengi Benefit Group",
    cpt: "73721",
    approval: { required: true, hasCriteria: true, policyId: "MSK-207" },
    evaluating: ready([
      met("1", "Knee pain documented"),
      { ...met("2", "PT"), result: "MET", sourceKind: "patient_reported", documentationRequired: true },
      unclear("4", "PT notes listed on the cover are not in the fax"),
    ]),
  }),
  passed({
    caseNumber: 3,
    name: "Sulu",
    expected: "CLINICAL_REVIEW",
    channel: "portal",
    insurer: "Andorian Life",
    cpt: "73221",
    approval: { required: true, hasCriteria: true, policyId: "IMG-330" },
    evaluating: ready([
      clinical("1", "Symptom duration", "3 weeks of symptoms (needs 6)"),
      clinical("2", "Therapy", "1 week of PT"),
      unclear("3", "no X-ray"),
      unclear("4", "no waiver"),
    ]),
  }),
  passed({ caseNumber: 4, name: "Janeway", expected: "READY_TO_SUBMIT", evaluating: ready([waived("2a", "Urinary retention"), waived("2b", "Saddle anesthesia"), met("2d", "No prior MRI")]) }),
  passed({ caseNumber: 5, name: "Chakotay", expected: "READY_TO_SUBMIT", channel: "portal", insurer: "Ferengi Benefit Group", cpt: "73721", approval: { required: true, hasCriteria: true, policyId: "MSK-207" }, evaluating: ready([met("1", "Left knee criteria met")]) }),
  passed({ caseNumber: 6, name: "Torres", expected: "CLINICAL_REVIEW", channel: "portal", insurer: "Andorian Life", cpt: "73221", approval: { required: true, hasCriteria: true, policyId: "IMG-330" }, evaluating: ready([clinical("prior", "Repeat MRI", "Left shoulder MRI on June 15 is inside 12 months, and there is no new injury")]) }),
  passed({ caseNumber: 7, name: "Tuvok", expected: "READY_TO_SUBMIT", insurer: "Vulcan Science Mutual", cpt: "70553", approval: { required: true, hasCriteria: true, policyId: "VSM-NEU-12" }, evaluating: ready([met("a", "Papilledema")]) }),
  passed({ caseNumber: 8, name: "Paris", expected: "CLINICAL_REVIEW", insurer: "Vulcan Science Mutual", cpt: "70551", approval: { required: true, hasCriteria: true, policyId: "VSM-NEU-12" }, evaluating: ready([clinical("ex", "Exclusion", "Stable migraine, normal exam")]) }),
  passed({ caseNumber: 9, name: "Picard", expected: "READY_TO_SUBMIT", insurer: "Klingon Assurance", cpt: "78815", approval: { required: true, hasCriteria: true, policyId: "KA-ONC-04" }, evaluating: ready([met("size", "Biopsied 2.4 cm lung cancer")]) }),
  passed({ caseNumber: 10, name: "Riker", expected: "CLINICAL_REVIEW", insurer: "Klingon Assurance", cpt: "78815", approval: { required: true, hasCriteria: true, policyId: "KA-ONC-04" }, evaluating: ready([clinical("size", "Nodule size", "7 mm nodule and no biopsy")]) }),
  passed({ caseNumber: 11, name: "Troi", expected: "NOT_REQUIRED", insurer: "Bajoran Health Plan", cpt: "74177", approval: { required: false, hasCriteria: false, policyId: "BHP-UM-01", why: "outpatient CT not on PA list" } }),
  passed({
    caseNumber: 12,
    name: "Crusher",
    expected: "AWAITING_DOCUMENTS",
    channel: "portal",
    insurer: "Ferengi Benefit Group",
    cpt: "73721",
    approval: { required: true, hasCriteria: true, policyId: "MSK-207" },
    evaluating: {
      criteria: [met("1", "Knee study")],
      confidenceThreshold: 0.85,
      pageIssues: [{ checkId: "PP-2", holdsRequiredEvidence: true, detail: "Office note (p.3) blank" }],
    },
  }),
  passed({
    caseNumber: 13,
    name: "La Forge",
    channel: null,
    insurer: "",
    cpt: "",
    preprocessing: { identityAndOrderUnreadable: true, unreadableFields: "therapy, imaging, member id", faxSender: "the clinic" },
    approval: undefined,
    coverage: undefined,
  }),
  passed({ caseNumber: 14, name: "Worf", expected: "READY_TO_SUBMIT", channel: "portal", insurer: "Andorian Life", cpt: "73221", approval: { required: true, hasCriteria: true, policyId: "IMG-330" }, evaluating: ready([waived("tx", "Dislocation on November 8")]) }),
  passed({ caseNumber: 15, name: "Nog", expected: "NEEDS_CORRECTION", matching: { ma3: false, detail: "Page 3 is for another patient (ROM, DOB 01/11/1975); quarantined" } }),
  passed({
    caseNumber: 16,
    name: "Yar",
    expected: "APPROVED",
    coverage: { cv1: true, existingApproval: { number: "FH-AUTH-2026-118842", cpt: "72148", validFrom: "2026-11-01", validTo: "2027-02-04", linked: true } },
  }),
  passed({
    caseNumber: 17,
    name: "O'Brien",
    expected: "NEEDS_CORRECTION",
    channel: "portal",
    insurer: "Ferengi Benefit Group",
    cpt: "73721",
    approval: { required: true, hasCriteria: true, policyId: "MSK-207" },
    evaluating: { criteria: [met("1", "Knee documented")], confidenceThreshold: 0.85, consistencyFailures: [{ id: "CO-1", detail: "Request says LEFT knee; office note, PT and X-ray say RIGHT" }] },
  }),
  passed({ caseNumber: 18, name: "Sisko", expected: "NEEDS_CORRECTION", coverage: { cv1: false, detail: "Order lists Federation Health; card scanned 11/09 shows Bajoran Health Plan from 11/01" } }),
  passed({ caseNumber: 19, name: "Kira", expected: "RULE_GAP", insurer: "Bajoran Health Plan", approval: { required: true, hasCriteria: false, policyId: "BHP-MRI", policyReference: "no lumbar MRI rule" } }),
  passed({ caseNumber: 20, name: "Odo", expected: "UNREADABLE", channel: null, insurer: "", cpt: "", source: "fax", preprocessing: { allPagesBlank: true, faxSender: "Promenade Urgent Care", faxNumber: "555-0148" }, approval: undefined, coverage: undefined }),
  passed({ caseNumber: 21, name: "Quark", expected: "NOT_REQUIRED", approval: { required: false, hasCriteria: true, policyId: "RAD-114", why: "inpatient order" } }),
  passed({ caseNumber: 22, name: "Bashir", expected: "READY_TO_SUBMIT", channel: "portal", insurer: "Andorian Life", cpt: "73221", approval: { required: true, hasCriteria: true, policyId: "IMG-330" }, evaluating: ready([met("1", "9 weeks of pain"), met("2", "7 weeks of therapy"), met("3", "X-ray")]) }),
  passed({ caseNumber: 23, name: "Dax", expected: "READY_TO_SUBMIT", evaluating: ready([exceptionMet("2d", "Symptoms materially changed"), waived("2a", "New foot drop")]) }),
];

export interface CaseRun {
  status: OrderStatus;
  reason: ReasonCode | null;
  linkedApproval: boolean;
  confirmOnly: boolean;
  urgent: boolean;
}

/** Runs the pipeline once and applies the single bucket decision. */
export function runCase(fixture: CaseFixture, now = new Date("2026-11-09T16:00:00")): CaseRun {
  const state = new AuthState();
  const created = createOrder(state, { channel: fixture.channel, status: "PROCESSING", step: "INTAKE", now });
  const decision = bucketRun(fixtureBucket(fixture));
  if (decision.status !== "PROCESSING") {
    transitionOrder(state, created.id, decision.status, {
      actor: { kind: "system" },
      expectedVersion: created.statusVersion,
      reason: decision.reason,
      step: decision.step,
      detail: decision.detail,
      otherIssues: decision.otherIssues,
      checkIds: decision.checkIds,
      approval: decision.reason === "LINKED_EXISTING" && fixture.coverage?.existingApproval ? { ...fixture.coverage.existingApproval, linked: true } : undefined,
      policyId: fixture.approval?.policyId ?? null,
      now,
    });
  }
  const order = readOrder(state, created.id);
  return {
    status: order.status,
    reason: order.reason,
    linkedApproval: order.linkedApproval,
    confirmOnly: order.confirmOnly,
    urgent: fixture.urgent === true,
  };
}

function fixtureBucket(fixture: CaseFixture): BucketInput {
  const pre = fixture.preprocessing ?? {};
  if (pre.allPagesBlank || pre.identityAndOrderUnreadable) {
    const sender = [pre.faxSender, pre.faxNumber].filter(Boolean).join(" ");
    return {
      unreadable: {
        document: "the fax",
        problem: pre.allPagesBlank ? "all pages blank" : `fields: ${pre.unreadableFields ?? "patient and order"}`,
        sender: sender || "the sender",
      },
    };
  }

  const matching = fixture.matching ?? {};
  if (matching.ma1 === false || matching.ma2 === false) {
    return {
      noMatch: { name: matching.name ?? "unknown", dob: matching.dob ?? "unknown", mrn: "none", candidates: matching.detail ?? "none" },
    };
  }

  const coverage = fixture.coverage;
  const approval = fixture.approval;
  const why = approval && "why" in approval ? approval.why : undefined;
  const evaluating = fixture.evaluating;
  const failures = [...(evaluating?.consistencyFailures ?? [])];
  if (matching.ma3 === false) failures.push({ id: "MA-3", detail: matching.detail ?? "A page is for another patient" });

  return {
    criteria: evaluating?.criteria,
    confidenceThreshold: evaluating?.confidenceThreshold ?? 0.85,
    consistencyFailures: failures,
    pageIssues: evaluating?.pageIssues,
    insurerMatches: coverage ? coverage.cv1 !== false : undefined,
    insurerMismatch: coverage?.cv1 === false ? insurerDetail(coverage.detail) : undefined,
    existingApproval: coverage?.existingApproval ? { ...coverage.existingApproval, linked: true } : null,
    approvalRequired: approval?.required,
    hasCriteria: approval?.hasCriteria,
    notRequiredReason: notRequiredReason(why),
    notRequiredDetail: {
      cpt: fixture.cpt || "this study",
      insurer: fixture.insurer || "the insurer",
      setting: /inpatient/i.test(why ?? "") ? "Inpatient" : "Outpatient",
    },
    ruleGapDetail: { insurer: fixture.insurer || "The insurer", cpt: fixture.cpt || "this study" },
    channel: fixture.channel,
    insurer: fixture.insurer,
    cpt: fixture.cpt,
    policyId: approval?.policyId,
    attachmentCount: fixture.pageCount,
    priorMissingDocumentsEntries: evaluating?.priorAwaitingDocumentsEntries,
    coordinatorFix: evaluating?.coordinatorFixSinceApprovalCheck,
    resolvedItem: evaluating?.resolvedItem,
    previousCriteria: evaluating?.previousCriteria,
    fixedCriterionIds: evaluating?.fixedCriterionIds,
    routingPolicy: evaluating?.routingPolicy,
    routingContext: evaluating?.routingContext,
    requestedItems: evaluating?.requestedItems,
  };
}

function notRequiredReason(why: string | undefined): "NOT_ON_PA_LIST" | "SETTING_EXEMPT" {
  return why != null && /\binpatient\b/i.test(why) ? "SETTING_EXEMPT" : "NOT_ON_PA_LIST";
}

function insurerDetail(text: string | undefined): BucketInput["insurerMismatch"] {
  return {
    insurerA: "Federation Health",
    source: text?.includes("card") ? "card scanned Nov 9" : "eligibility check",
    insurerB: "Bajoran Health Plan",
    date: "Nov 1",
    note: text ?? "",
  };
}


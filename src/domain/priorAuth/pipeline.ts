import { decideEvaluating, type EvaluatingInput } from "./decision";
import { AuthState, createOrder, readAudits, readOrder, transitionOrder } from "./store";
import type { ApprovalInput, Channel, CriterionResult, OrderSnapshot, OrderStatus } from "./types";

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

interface Step {
  to: OrderStatus;
  reason: string;
  checkIds: string[];
  approval?: ApprovalInput;
  confirmOnly?: boolean;
  policyId?: string | null;
  criterionResults?: CriterionResult[];
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

function passed(partial: Partial<CaseFixture> & Pick<CaseFixture, "caseNumber" | "name" | "expected">): CaseFixture {
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
    ...partial,
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
    expected: "AWAITING_DOCUMENTS",
    channel: null,
    evaluating: ready([unclear("therapy", "PT summary dates illegible"), { ...met("member", "Member id"), confidence: 0.4 }]),
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
  reason: string;
  linkedApproval: boolean;
  confirmOnly: boolean;
}

/** Walks automatic transitions until a person, a closed status, or Ready to submit. */
export function runCase(fixture: CaseFixture, now = new Date("2026-11-09T16:00:00")): CaseRun {
  const state = new AuthState();
  const created = createOrder(state, { channel: fixture.channel, now });
  for (let step = 0; step < 12; step += 1) {
    const current = readOrder(state, created.id);
    const next = nextAutomatic(current, fixture);
    if (!next) break;
    transitionOrder(state, created.id, next.to, {
      actor: { kind: "system" },
      expectedVersion: current.statusVersion,
      reason: next.reason,
      checkIds: next.checkIds,
      approval: next.approval,
      confirmOnly: next.confirmOnly,
      policyId: next.policyId,
      criterionResults: next.criterionResults,
      now,
    });
  }
  const order = readOrder(state, created.id);
  const audits = readAudits(state, { orderId: created.id });
  return {
    status: order.status,
    reason: audits.at(-1)?.reason ?? "",
    linkedApproval: order.linkedApproval,
    confirmOnly: order.confirmOnly,
  };
}

function nextAutomatic(order: OrderSnapshot, fixture: CaseFixture): Step | null {
  switch (order.status) {
    case "RECEIVED":
      return { to: "PRE_PROCESSING", reason: `Checking ${fixture.pageCount} pages`, checkIds: [] };
    case "PRE_PROCESSING":
      return leavePreprocessing(fixture);
    case "MATCHING":
      return leaveMatching(fixture);
    case "COVERAGE_CHECK":
      return leaveCoverage(fixture);
    case "APPROVAL_CHECK":
      return leaveApproval(fixture);
    case "COLLECTING_EVIDENCE":
      return leaveCollecting(fixture);
    case "EVALUATING":
      return leaveEvaluating(order, fixture);
    default:
      return null;
  }
}

function leavePreprocessing(fixture: CaseFixture): Step {
  const pre = fixture.preprocessing ?? {};
  if (pre.allPagesBlank) {
    const sender = [pre.faxSender, pre.faxNumber].filter(Boolean).join(" ");
    return { to: "UNREADABLE", reason: `All ${fixture.pageCount} pages blank. Sender: ${sender}`, checkIds: ["PP-2"] };
  }
  if (pre.identityAndOrderUnreadable) {
    return { to: "UNREADABLE", reason: `Unreadable: ${pre.unreadableFields ?? "patient and order"}`, checkIds: ["PP-5"] };
  }
  return { to: "MATCHING", reason: "Matching to patient and order", checkIds: ["PP-2", "PP-3", "PP-5"] };
}

function leaveMatching(fixture: CaseFixture): Step {
  const matching = fixture.matching ?? {};
  if (matching.ma3 === false) {
    return { to: "NEEDS_CORRECTION", reason: matching.detail ?? "A page is for another patient; quarantined", checkIds: ["MA-3"] };
  }
  if (matching.ma1 === false || matching.ma2 === false) {
    const failed = matching.ma1 === false ? "MA-1" : "MA-2";
    return { to: "UNMATCHED", reason: `No match for ${matching.name ?? "unknown"}, DOB ${matching.dob ?? "?"}`, checkIds: [failed] };
  }
  return { to: "COVERAGE_CHECK", reason: "Checking eligibility and approvals on file", checkIds: ["MA-1", "MA-2", "MA-3"] };
}

function leaveCoverage(fixture: CaseFixture): Step {
  const coverage = fixture.coverage ?? { cv1: true };
  if (coverage.cv1 === false) {
    return { to: "NEEDS_CORRECTION", reason: coverage.detail ?? "Eligibility does not match the scan date", checkIds: ["CV-1"] };
  }
  if (coverage.existingApproval) {
    return { to: "APPROVED", reason: "Linked existing approval", checkIds: ["CV-2"], approval: { ...coverage.existingApproval, linked: true } };
  }
  return { to: "APPROVAL_CHECK", reason: `Looking up ${fixture.insurer || "insurer"} rules for CPT ${fixture.cpt || "unknown"}`, checkIds: [] };
}

function leaveApproval(fixture: CaseFixture): Step {
  const approval = fixture.approval ?? stubRuleEngine({ insurer: fixture.insurer, plan: null, cpt: fixture.cpt, setting: null });
  const required = "approvalRequired" in approval ? approval.approvalRequired : approval.required;
  const policyId = approval.policyId;
  if (!required) {
    const why = "why" in approval ? approval.why : null;
    return { to: "NOT_REQUIRED", reason: `Not required: ${policyId ?? "policy"} (${why ?? "not on the PA list"})`, checkIds: [], policyId };
  }
  const hasCriteria = "hasCriteria" in approval ? approval.hasCriteria : approval.criteria != null;
  if (!hasCriteria) {
    const reference = "policyReference" in approval ? approval.policyReference : undefined;
    return {
      to: "RULE_GAP",
      reason: `${fixture.insurer || "Insurer"} requires approval for ${fixture.cpt || "this study"}; no criteria in library${reference ? ` (${reference})` : ""}`,
      checkIds: [],
    };
  }
  return { to: "COLLECTING_EVIDENCE", reason: "Pulling records and extracting evidence", checkIds: [] };
}

function leaveCollecting(fixture: CaseFixture): Step {
  if (fixture.outsideRecord) {
    return { to: "AWAITING_DOCUMENTS", reason: fixture.outsideRecord, checkIds: ["EV-2"] };
  }
  const count = fixture.evaluating?.criteria.length ?? 0;
  const policyId = fixture.approval?.policyId ?? "policy";
  return { to: "EVALUATING", reason: `Checking ${count} criteria against ${policyId}`, checkIds: [] };
}

function leaveEvaluating(order: OrderSnapshot, fixture: CaseFixture): Step {
  if (!fixture.evaluating) throw new Error(`Case ${fixture.caseNumber} ${fixture.name} reached Evaluating without criteria`);
  const decision = decideEvaluating({ ...fixture.evaluating, priorAwaitingDocumentsEntries: order.awaitingDocumentsEntries });
  return {
    to: decision.status,
    reason: decision.reason,
    checkIds: decision.checkIds,
    confirmOnly: decision.confirmOnly,
    criterionResults: fixture.evaluating.criteria,
  };
}

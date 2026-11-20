import { MISSING_DOCUMENTS_LOOP_LIMIT } from "./catalog";
import { resolveRouting } from "./routing";
import type {
  ApprovalInput,
  Channel,
  CriterionResult,
  CriterionResultCode,
  OrderStatus,
  OtherIssue,
  ProcessingStep,
  ReasonCode,
  ReasonDetail,
  RoutingContext,
  RoutingPolicy,
} from "./types";

const PASSING: readonly CriterionResultCode[] = ["MET", "WAIVED", "EXCEPTION_MET"];

export interface ConsistencyFailure {
  id: "CO-1" | "CO-2" | "CO-3" | "CO-4" | "CO-5" | "MA-3" | string;
  detail: string;
}

export interface PageIssue {
  checkId: "PP-2" | "PP-3" | "PP-4";
  holdsRequiredEvidence: boolean;
  detail: string;
}

export interface BucketInput {
  criteria?: CriterionResult[];
  confidenceThreshold?: number;
  consistencyFailures?: ConsistencyFailure[];
  pageIssues?: PageIssue[];
  /** PP-2 on the whole document, or PP-5 on identity / order fields. */
  unreadable?: { document?: string; problem?: string; sender?: string } | null;
  /** MA-1 or MA-2. No confident patient or order match. */
  noMatch?: { name?: string; dob?: string; mrn?: string; candidates?: string } | null;
  /** CV-1. False when the insurer on the order is not the active one. */
  insurerMatches?: boolean;
  insurerMismatch?: ReasonDetail;
  /** CV-2. An approval already on file covers this patient, CPT and scan date. */
  existingApproval?: ApprovalInput | null;
  approvalRequired?: boolean;
  hasCriteria?: boolean;
  notRequiredReason?: "NOT_ON_PA_LIST" | "SETTING_EXEMPT";
  notRequiredDetail?: ReasonDetail;
  ruleGapDetail?: ReasonDetail;
  channel?: Channel | null;
  insurer?: string;
  cpt?: string;
  policyId?: string;
  submissionFailures?: number;
  submissionError?: string;
  /** Times the order has already entered MISSING_DOCUMENTS. */
  priorMissingDocumentsEntries?: number;
  requestedItems?: string[];
  requestedDates?: string;
  coordinatorFix?: boolean;
  resolvedItem?: string;
  previousCriteria?: CriterionResult[];
  fixedCriterionIds?: string[];
  routingPolicy?: RoutingPolicy;
  routingContext?: RoutingContext;
  attachmentCount?: number;
}

export interface BucketDecision {
  status: OrderStatus;
  reason: ReasonCode | null;
  step: ProcessingStep | null;
  detail: ReasonDetail;
  otherIssues: OtherIssue[];
  /** Which bucketing rule won: 1 unreadable, 2 coverage, 3 rules, 4 consistency, 5 clinical, 6 documents, 7 ready. */
  rule: "1" | "2" | "3" | "4" | "5" | "6" | "7";
  confirmOnly: boolean;
  checkIds: string[];
}

interface Candidate {
  rank: number;
  rule: BucketDecision["rule"];
  status: OrderStatus;
  reason: ReasonCode | null;
  step: ProcessingStep | null;
  detail: ReasonDetail;
  issue: boolean;
  checkIds: string[];
  confirmOnly?: boolean;
}

/**
 * Where PROCESSING lands when a run finishes. First matching rank wins.
 * Every other problem found in the same run is kept on otherIssues.
 * UNCLEAR never counts as Met. Patient-reported treatment is not documentation.
 */
export function bucketRun(input: BucketInput): BucketDecision {
  const threshold = input.confidenceThreshold ?? 0.85;
  const criteria = normalizeCriteria(input.criteria ?? [], threshold);
  const candidates: Candidate[] = [];

  if (input.unreadable) {
    candidates.push({
      rank: 1,
      rule: "1",
      status: "NEEDS_ADMIN_REVIEW",
      reason: "UNREADABLE_DOCUMENT",
      step: null,
      issue: true,
      checkIds: ["PP-2"],
      detail: {
        document: input.unreadable.document ?? "the document",
        problem: input.unreadable.problem ?? "all pages blank",
        sender: input.unreadable.sender ?? "the sender",
      },
    });
  }
  if (input.noMatch) {
    candidates.push({
      rank: 1,
      rule: "1",
      status: "NEEDS_ADMIN_REVIEW",
      reason: "NO_MATCH",
      step: null,
      issue: true,
      checkIds: ["MA-1"],
      detail: {
        name: input.noMatch.name ?? "unknown",
        dob: input.noMatch.dob ?? "unknown",
        mrn: input.noMatch.mrn ?? "none",
        candidates: input.noMatch.candidates ?? "none",
      },
    });
  }

  if (input.insurerMatches === false) {
    candidates.push({
      rank: 2,
      rule: "2",
      status: "NEEDS_ADMIN_REVIEW",
      reason: "INSURER_MISMATCH",
      step: null,
      issue: true,
      checkIds: ["CV-1"],
      detail: input.insurerMismatch ?? {
        insurerA: "the order's insurer",
        source: "eligibility check",
        insurerB: "another insurer",
        date: "the scan date",
      },
    });
  } else if (input.existingApproval) {
    const approval = input.existingApproval;
    candidates.push({
      rank: 2,
      rule: "2",
      status: "APPROVED",
      reason: "LINKED_EXISTING",
      step: null,
      issue: false,
      checkIds: ["CV-2"],
      detail: {
        number: approval.number,
        cpt: approval.cpt,
        validFrom: approval.validFrom,
        validTo: approval.validTo,
      },
    });
  }

  if (input.approvalRequired === false) {
    const why = input.notRequiredReason ?? "NOT_ON_PA_LIST";
    candidates.push({
      rank: 3,
      rule: "3",
      status: "NOT_REQUIRED",
      reason: why,
      step: null,
      issue: false,
      checkIds: [],
      detail: input.notRequiredDetail ?? {
        cpt: input.cpt ?? "this study",
        insurer: input.insurer ?? "the insurer",
        setting: "this setting",
      },
    });
  } else if (input.approvalRequired === true && input.hasCriteria === false) {
    candidates.push({
      rank: 3,
      rule: "3",
      status: "NEEDS_CLINICAL_REVIEW",
      reason: "RULE_GAP",
      step: null,
      issue: true,
      checkIds: [],
      detail: input.ruleGapDetail ?? { insurer: input.insurer ?? "The insurer", cpt: input.cpt ?? "this study" },
    });
  }

  for (const failure of input.consistencyFailures ?? []) {
    const mapped = consistencyReason(failure);
    if (!mapped) continue;
    candidates.push({
      rank: 4,
      rule: "4",
      status: "NEEDS_ADMIN_REVIEW",
      reason: mapped.reason,
      step: null,
      issue: true,
      checkIds: [failure.id],
      detail: mapped.detail,
    });
  }

  const clinical = criteria.filter((c) => c.result === "NOT_MET" && c.failureClass === "clinical");
  const gaps = documentGaps(criteria, input.pageIssues ?? []);
  if (clinical.length > 0) {
    candidates.push({
      rank: 5,
      rule: "5",
      status: "NEEDS_CLINICAL_REVIEW",
      reason: "CRITERIA_NOT_MET",
      step: null,
      issue: true,
      checkIds: clinical.map((c) => c.criterionId),
      detail: {
        policy: input.policyId ?? "the policy",
        failures: clinical.map(criterionLine).join("; "),
        action: "talk to the ordering doctor",
        doctor: "the ordering doctor",
      },
    });
  }

  if (gaps.length > 0) {
    const prior = input.priorMissingDocumentsEntries ?? 0;
    const repeated = prior >= MISSING_DOCUMENTS_LOOP_LIMIT;
    const items = (input.requestedItems ?? gaps.map((gap) => gap.line)).filter(Boolean);
    candidates.push({
      rank: 6,
      rule: "6",
      status: repeated ? "NEEDS_CLINICAL_REVIEW" : "NEEDS_ADMIN_REVIEW",
      reason: repeated ? "REPEATED_REQUESTS" : "MISSING_DOCUMENTS",
      step: null,
      issue: true,
      checkIds: gaps.map((gap) => gap.checkId),
      detail: repeated
        ? { items: items.join(", "), dates: input.requestedDates ?? "the last three requests" }
        : {
            document: gaps[0]?.document ?? "a required document",
            source: gaps[0]?.source ?? "the sender",
            requested: "today",
            followUp: "the next business day",
            criterion: gaps.map((gap) => gap.line).join("; "),
          },
    });
  }

  if (candidates.length === 0 || !candidates.some((item) => item.rank < 7 && blocksReady(item, clinical.length, gaps.length))) {
    const ready = readyCandidate(input, criteria, threshold);
    if (ready) candidates.push(ready);
  }

  // A clinical failure still records the document gap, and a repeated chase still records it.
  // Drop the document candidate from the winner list only when a higher rank already won;
  // it stays available as an other issue below.
  const ranked = [...candidates].sort((a, b) => a.rank - b.rank || a.checkIds.join().localeCompare(b.checkIds.join()));
  const winner = ranked[0];
  if (!winner) {
    return {
      status: "PROCESSING",
      reason: null,
      step: "EVALUATING",
      detail: { insurer: input.insurer ?? "the insurer", n: criteria.length },
      otherIssues: [],
      rule: "7",
      confirmOnly: false,
      checkIds: [],
    };
  }

  const otherIssues: OtherIssue[] = ranked
    .slice(1)
    .filter((item) => item.issue && item.reason && item.reason !== winner.reason)
    .map((item) => ({ code: item.reason as ReasonCode, detail: item.detail }));

  // Same-code gaps (two missing documents) stay on the winner's detail; a different code is an other issue.
  // Clinical-not-met plus a document gap: the gap is a different code, so it is listed.
  if (winner.reason === "CRITERIA_NOT_MET") {
    const gap = ranked.find((item) => item.reason === "MISSING_DOCUMENTS" || item.reason === "REPEATED_REQUESTS");
    if (gap?.reason && !otherIssues.some((issue) => issue.code === gap.reason)) {
      otherIssues.push({ code: gap.reason, detail: gap.detail });
    }
  }
  if (winner.reason === "REPEATED_REQUESTS" && gaps.length > 0) {
    otherIssues.push({
      code: "MISSING_DOCUMENTS",
      detail: {
        document: gaps[0]?.document ?? "a required document",
        source: gaps[0]?.source ?? "the sender",
        requested: "today",
        followUp: "the next business day",
        criterion: gaps.map((gap) => gap.line).join("; "),
      },
    });
  }

  return {
    status: winner.status,
    reason: winner.reason,
    step: winner.step,
    detail: winner.detail,
    otherIssues,
    rule: winner.rule,
    confirmOnly: winner.confirmOnly === true,
    checkIds: winner.checkIds,
  };
}

function blocksReady(item: Candidate, clinical: number, gaps: number): boolean {
  if (item.rank >= 7) return false;
  if (item.reason === "MISSING_DOCUMENTS" && clinical > 0) return false;
  if (item.reason === "REPEATED_REQUESTS") return true;
  if (gaps > 0 && item.rank === 6) return true;
  return item.rank < 6 || item.reason !== "MISSING_DOCUMENTS";
}

function readyCandidate(input: BucketInput, criteria: CriterionResult[], threshold: number): Candidate | null {
  const criteriaGiven = (input.criteria ?? []).length > 0 || input.approvalRequired === true;
  if (!criteriaGiven && input.approvalRequired !== true) return null;
  if (input.approvalRequired === true && input.hasCriteria === false) return null;

  const signoff = confirmAfterFix(input, criteria, threshold);
  if (signoff) return signoff;

  const failures = input.submissionFailures ?? 0;
  if (input.channel === "api" && failures >= 3) {
    return {
      rank: 7,
      rule: "7",
      status: "NEEDS_ADMIN_REVIEW",
      reason: "SUBMISSION_FAILED",
      step: null,
      issue: true,
      checkIds: [],
      detail: { insurer: input.insurer ?? "The insurer", error: input.submissionError ?? "the request was rejected", n: failures },
    };
  }
  if (input.channel === "api") {
    return {
      rank: 7,
      rule: "7",
      status: "SUBMITTED",
      reason: "INITIAL_REQUEST",
      step: null,
      issue: false,
      checkIds: [],
      detail: {
        insurer: input.insurer ?? "the insurer",
        channel: "API",
        date: "today",
        ref: "pending",
        time: "just now",
      },
    };
  }
  return {
    rank: 7,
    rule: "7",
    status: "NEEDS_ADMIN_REVIEW",
    reason: "PORTAL_UPLOAD",
    step: null,
    issue: true,
    checkIds: [],
    detail: {
      n: criteria.length,
      insurer: input.insurer ?? "the insurer",
      k: input.attachmentCount ?? criteria.length,
    },
  };
}

function confirmAfterFix(input: BucketInput, criteria: CriterionResult[], threshold: number): Candidate | null {
  if (!input.coordinatorFix || !input.routingPolicy) return null;
  const resolved = resolveRouting(input.routingPolicy, input.routingContext ?? {});
  const confirm = resolved.mode === "nurse_signoff" || (resolved.mode === "nurse_if_changed" && !onlyFixedChanged(criteria, input, threshold));
  if (!confirm && resolved.mode !== "nurse_if_changed") return null;
  if (!confirm) return null;
  return {
    rank: 7,
    rule: "7",
    status: "NEEDS_CLINICAL_REVIEW",
    reason: "CONFIRM_AFTER_FIX",
    step: null,
    issue: true,
    confirmOnly: true,
    checkIds: [],
    detail: {
      item: input.resolvedItem?.trim() || "the records",
      n: criteria.length,
      diff: "the failing criterion now passes",
    },
  };
}

function consistencyReason(failure: ConsistencyFailure): { reason: ReasonCode; detail: ReasonDetail } | null {
  if (failure.id === "CO-1") {
    return { reason: "SIDE_MISMATCH", detail: sideDetail(failure.detail) };
  }
  if (failure.id === "MA-3" || failure.id === "CO-4") {
    return { reason: "WRONG_PATIENT_PAGE", detail: wrongPatientDetail(failure.detail) };
  }
  if (failure.id === "CO-2" || failure.id === "CO-3") {
    return { reason: "CPT_MISMATCH", detail: { cpt: "the ordered CPT", what: failure.detail || "the procedure", doctor: "the ordering doctor" } };
  }
  if (failure.id === "CO-5" || failure.id === "CV-1") {
    return {
      reason: "INSURER_MISMATCH",
      detail: { insurerA: "the order's insurer", source: "the card", insurerB: "the card's insurer", date: "the scan date", note: failure.detail },
    };
  }
  return null;
}

function sideDetail(text: string): ReasonDetail {
  return {
    side: /left/i.test(text) ? "left" : "one side",
    bodyPart: /knee/i.test(text) ? "knee" : "the study",
    n: 1,
    otherSide: /right/i.test(text) ? "right" : "the other side",
    records: text || "the records",
    doctor: "the ordering doctor",
  };
}

function wrongPatientDetail(text: string): ReasonDetail {
  const page = /page\s+(\d+)/i.exec(text)?.[1] ?? "1";
  return { page, name: "another patient", dob: "unknown", sender: "the sender", note: text };
}

function normalizeCriteria(criteria: CriterionResult[], fallbackThreshold: number): CriterionResult[] {
  return criteria.map((c) => {
    if (c.sourceKind === "patient_reported" && c.documentationRequired !== false) {
      return { ...c, result: "UNCLEAR", failureClass: "documents" };
    }
    const passing = PASSING.includes(c.result);
    if (passing && c.confidence < (c.threshold ?? fallbackThreshold)) {
      return { ...c, result: "UNCLEAR", failureClass: "documents" };
    }
    if ((c.result === "NOT_MET" || c.result === "UNCLEAR") && c.failureClass == null) {
      return { ...c, failureClass: c.result === "NOT_MET" ? "clinical" : "documents" };
    }
    return c;
  });
}

function documentGaps(criteria: CriterionResult[], pageIssues: PageIssue[]): { checkId: string; line: string; document: string; source: string }[] {
  const fromPages = pageIssues
    .filter((page) => page.holdsRequiredEvidence)
    .map((page) => ({
      checkId: page.checkId,
      line: page.detail,
      document: page.detail,
      source: "the sender",
    }));
  const fromCriteria = criteria
    .filter((c) => c.result === "UNCLEAR" || (c.result === "NOT_MET" && c.failureClass === "documents"))
    .map((c) => ({
      checkId: c.criterionId,
      line: criterionLine(c),
      document: c.label ?? c.criterionId,
      source: "the sender",
    }));
  return [...fromPages, ...fromCriteria];
}

function criterionLine(c: CriterionResult): string {
  const name = c.label ?? c.criterionId;
  const quote = c.evidence?.quote;
  return quote ? `${name}: ${quote}` : name;
}

function onlyFixedChanged(criteria: CriterionResult[], input: BucketInput, threshold: number): boolean {
  const previous = input.previousCriteria;
  if (!previous || previous.length !== criteria.length) return false;
  if (!criteria.every((c) => c.confidence >= (c.threshold ?? threshold) || PASSING.includes(c.result))) return false;
  const fixed = new Set(input.fixedCriterionIds ?? []);
  for (const current of criteria) {
    const before = previous.find((item) => item.criterionId === current.criterionId);
    if (!before) return false;
    const changed = before.result !== current.result || before.failureClass !== current.failureClass || before.confidence !== current.confidence;
    if (changed && !fixed.has(current.criterionId)) return false;
  }
  return true;
}

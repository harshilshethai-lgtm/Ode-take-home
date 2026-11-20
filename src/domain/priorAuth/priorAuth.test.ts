import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketRun } from "./bucket";
import {
  AuthState,
  CASE_FIXTURES,
  DOCUMENT_STATUSES,
  EXAMPLE_DETAILS,
  IllegalTransitionError,
  ORDER_STATUSES,
  REASON_CODES,
  StaleVersionError,
  actionsFor,
  buildCaseSummary,
  createDocument,
  createOrder,
  documentsForPacket,
  explainReason,
  guardSummary,
  isLegalDocumentTransition,
  isLegalOrderTransition,
  isWritableStatus,
  migrateOrder,
  quarantineWrongPatientPage,
  readAudits,
  readEffects,
  readOrder,
  renderActions,
  renderStatusCatalog,
  resolveRouting,
  runCase,
  transitionDocument,
  transitionOrder,
  unfilledPlaceholders,
  whatToDo,
  type Actor,
  type CriterionResult,
  type DocumentStatus,
  type OrderStatus,
  type ReasonCode,
  type RoutingPolicy,
  type TransitionContext,
} from "./index";

const root = resolve(__dirname, "../../..");
const system: Actor = { kind: "system" };
const coordinator: Actor = { kind: "user", id: "p-jasmine", role: "coordinator", permissions: ["cancel"] };
const nurse: Actor = { kind: "user", id: "p-priya", role: "nurse", permissions: ["cancel"] };
const approval = { number: "A-100", cpt: "72148", validFrom: "2026-11-01", validTo: "2027-02-01" };

function fromReason(from: OrderStatus, to: OrderStatus): ReasonCode | null {
  if (from === "PROCESSING") return null;
  if (from === "NEEDS_ADMIN_REVIEW") {
    if (to === "SUBMITTED") return "PORTAL_UPLOAD";
    if (to === "APPROVED") return "WRITEBACK_FAILED";
    return "MISSING_DOCUMENTS";
  }
  if (from === "NEEDS_CLINICAL_REVIEW") {
    if (to === "SUBMITTED") return "DENIED_DECIDE_APPEAL";
    if (to === "APPROVED") return "PEER_TO_PEER";
    return "CRITERIA_NOT_MET";
  }
  if (from === "SUBMITTED") return "INITIAL_REQUEST";
  if (from === "APPROVED") return "NEW";
  if (from === "NOT_REQUIRED") return "NOT_ON_PA_LIST";
  if (from === "DENIED") return "NO_APPEAL";
  return "EPIC_CANCELLED";
}

function toReason(from: OrderStatus, to: OrderStatus): ReasonCode | null {
  if (to === "PROCESSING") return null;
  if (to === "NEEDS_ADMIN_REVIEW") return from === "SUBMITTED" ? "MORE_INFO_REQUESTED" : "MISSING_DOCUMENTS";
  if (to === "NEEDS_CLINICAL_REVIEW") return from === "SUBMITTED" ? "DENIED_DECIDE_APPEAL" : "CRITERIA_NOT_MET";
  if (to === "SUBMITTED") return from === "NEEDS_CLINICAL_REVIEW" ? "APPEAL" : "INITIAL_REQUEST";
  if (to === "APPROVED") return from === "PROCESSING" ? "LINKED_EXISTING" : "NEW";
  if (to === "NOT_REQUIRED") return "NOT_ON_PA_LIST";
  if (to === "DENIED") return "NO_APPEAL";
  if (to === "CANCELLED") return from === "NEEDS_CLINICAL_REVIEW" ? "WITHDRAWN_BY_NURSE" : "WITHDRAWN_BY_COORDINATOR";
  return null;
}

function actorFor(from: OrderStatus, to: OrderStatus): Actor {
  if (to === "CANCELLED") return from === "NEEDS_CLINICAL_REVIEW" ? nurse : coordinator;
  if (from === "NEEDS_CLINICAL_REVIEW") return nurse;
  if (from === "NEEDS_ADMIN_REVIEW") return coordinator;
  return system;
}

function contextFor(from: OrderStatus, to: OrderStatus): TransitionContext {
  const reason = toReason(from, to);
  const ctx: TransitionContext = {
    actor: actorFor(from, to),
    expectedVersion: 1,
    reason,
    detail: reason ? EXAMPLE_DETAILS[reason] : { n: 4, insurer: "Federation Health" },
    step: to === "PROCESSING" ? "INTAKE" : null,
    note: "Reviewed against the policy",
    portalReference: "PORTAL-1",
  };
  if (to === "APPROVED") ctx.approval = { ...approval, linked: reason === "LINKED_EXISTING" };
  if (from === "NEEDS_CLINICAL_REVIEW" && to === "PROCESSING") ctx.trigger = "approve_for_submission";
  if (from === "APPROVED" && to === "PROCESSING") {
    ctx.epicEvent = "scan_outside_approval";
    ctx.step = "COVERAGE";
    ctx.detail = { whatChanged: "scan date moved outside approval", insurer: "Federation Health", n: 4 };
  }
  if (from === "NEEDS_ADMIN_REVIEW" && to === "APPROVED") {
    ctx.writeBackConfirmed = true;
    ctx.epicAuthId = "E-100";
  }
  if (from === "NEEDS_CLINICAL_REVIEW" && to === "APPROVED") ctx.writeBackConfirmed = true;
  return ctx;
}

function seed(from: OrderStatus, to: OrderStatus) {
  const state = new AuthState();
  const order = createOrder(state, {
    status: from,
    reason: fromReason(from, to),
    step: from === "PROCESSING" ? "EVALUATING" : null,
    channel: "portal",
    detail: { document: "PT notes", source: "the clinic", requested: "Nov 9", followUp: "Nov 10", criterion: "therapy" },
  });
  return { state, order };
}

const met = (id: string, confidence = 0.95): CriterionResult => ({
  criterionId: id,
  result: "MET",
  failureClass: null,
  confidence,
  evidence: { documentId: "packet", page: 1, quote: "documented" },
  label: id,
});

describe("order transitions", () => {
  const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => ({ from, to })));

  it("lets every legal pair succeed and rejects every other pair", () => {
    for (const { from, to } of pairs) {
      const { state, order } = seed(from, to);
      const ctx = contextFor(from, to);
      if (isLegalOrderTransition(from, to)) {
        const next = transitionOrder(state, order.id, to, ctx);
        expect(next.status, `${from} -> ${to}`).toBe(to);
        expect(next.reason, `${from} -> ${to}`).toBe(ctx.reason);
        const audit = readAudits(state, { orderId: order.id }).at(-1);
        expect(audit?.fromStatus).toBe(from);
        expect(audit?.toStatus).toBe(to);
      } else {
        expect(() => transitionOrder(state, order.id, to, ctx), `${from} -> ${to}`).toThrow(IllegalTransitionError);
      }
    }
  });

  it("rejects every move out of a closed status", () => {
    for (const from of ["NOT_REQUIRED", "DENIED", "CANCELLED"] as const) {
      for (const to of ORDER_STATUSES) {
        const { state, order } = seed(from, to);
        expect(() => transitionOrder(state, order.id, to, contextFor(from, to))).toThrow(IllegalTransitionError);
      }
    }
    for (const to of ORDER_STATUSES) {
      if (to === "PROCESSING") continue;
      const { state, order } = seed("APPROVED", to);
      expect(() => transitionOrder(state, order.id, to, contextFor("APPROVED", to))).toThrow(IllegalTransitionError);
    }
  });

  it("fails a stale version before any other check", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "PROCESSING", step: "INTAKE" });
    transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
      actor: system,
      expectedVersion: 1,
      reason: "MISSING_DOCUMENTS",
      detail: EXAMPLE_DETAILS.MISSING_DOCUMENTS,
    });
    expect(() =>
      transitionOrder(state, order.id, "CANCELLED", {
        actor: coordinator,
        expectedVersion: 1,
        reason: "WITHDRAWN_BY_COORDINATOR",
        detail: EXAMPLE_DETAILS.WITHDRAWN_BY_COORDINATOR,
      }),
    ).toThrow(StaleVersionError);
    expect(readOrder(state, order.id).status).toBe("NEEDS_ADMIN_REVIEW");
  });
});

describe("document transitions", () => {
  const pairs = DOCUMENT_STATUSES.flatMap((from) => DOCUMENT_STATUSES.map((to) => ({ from, to })));

  it("lets every legal pair succeed and rejects every other pair", () => {
    for (const { from, to } of pairs) {
      const state = new AuthState();
      const doc = createDocument(state, { status: from, pageNumbers: [1], orderId: null });
      const ctx: TransitionContext = { actor: system, expectedVersion: 1, reason: null, note: "Move" };
      if (isLegalDocumentTransition(from, to)) {
        expect(transitionDocument(state, doc.id, to, ctx).status).toBe(to);
      } else {
        expect(() => transitionDocument(state, doc.id, to, ctx)).toThrow(IllegalTransitionError);
      }
    }
  });

  it("rejects every move out of a closed document", () => {
    for (const from of ["QUARANTINED", "SUPERSEDED"] as const) {
      for (const to of DOCUMENT_STATUSES) {
        const state = new AuthState();
        const doc = createDocument(state, { status: from as DocumentStatus, pageNumbers: [1] });
        expect(() => transitionDocument(state, doc.id, to, { actor: system, expectedVersion: 1, reason: null, note: "Move" })).toThrow(IllegalTransitionError);
      }
    }
  });
});

describe("bucketing order", () => {
  const threshold = 0.85;

  it("stops at an unreadable document before coverage or criteria", () => {
    const decision = bucketRun({
      unreadable: { document: "the fax", problem: "all pages blank", sender: "Promenade Urgent Care" },
      criteria: [{ ...met("2a"), result: "NOT_MET", failureClass: "clinical" }],
      insurerMatches: false,
    });
    expect(decision).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "UNREADABLE_DOCUMENT", rule: "1" });
  });

  it("sends a coverage mismatch to admin review before the rule engine", () => {
    const decision = bucketRun({
      insurerMatches: false,
      insurerMismatch: EXAMPLE_DETAILS.INSURER_MISMATCH,
      approvalRequired: false,
    });
    expect(decision).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "INSURER_MISMATCH", rule: "2" });
  });

  it("links an approval already on file and does not submit", () => {
    const decision = bucketRun({
      insurerMatches: true,
      existingApproval: { ...approval, linked: true },
      approvalRequired: true,
      hasCriteria: true,
      criteria: [met("2a")],
      channel: "api",
    });
    expect(decision).toMatchObject({ status: "APPROVED", reason: "LINKED_EXISTING", rule: "2" });
  });

  it("closes as not required when the rule engine says so", () => {
    expect(bucketRun({ approvalRequired: false, notRequiredReason: "NOT_ON_PA_LIST", notRequiredDetail: EXAMPLE_DETAILS.NOT_ON_PA_LIST }).reason).toBe("NOT_ON_PA_LIST");
    expect(bucketRun({ approvalRequired: false, notRequiredReason: "SETTING_EXEMPT", notRequiredDetail: EXAMPLE_DETAILS.SETTING_EXEMPT }).reason).toBe("SETTING_EXEMPT");
  });

  it("sends a missing rule to clinical review", () => {
    const decision = bucketRun({ approvalRequired: true, hasCriteria: false, ruleGapDetail: EXAMPLE_DETAILS.RULE_GAP });
    expect(decision).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "RULE_GAP", rule: "3" });
  });

  it("sends a consistency failure to admin review ahead of a clinical failure", () => {
    const decision = bucketRun({
      confidenceThreshold: threshold,
      approvalRequired: true,
      hasCriteria: true,
      consistencyFailures: [{ id: "CO-1", detail: "Request says LEFT knee; office note says RIGHT" }],
      criteria: [{ ...met("2a"), result: "NOT_MET", failureClass: "clinical" }],
    });
    expect(decision).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "SIDE_MISMATCH", rule: "4" });
  });

  it("sends clinical Not met plus a missing document to clinical review, and keeps the document gap", () => {
    const decision = bucketRun({
      confidenceThreshold: threshold,
      approvalRequired: true,
      hasCriteria: true,
      policyId: "IMG-330",
      criteria: [
        { ...met("pain"), result: "NOT_MET", failureClass: "clinical", label: "3 weeks of symptoms (needs 6)" },
        { ...met("pt"), result: "UNCLEAR", failureClass: "documents", label: "PT notes" },
      ],
    });
    expect(decision.status).toBe("NEEDS_CLINICAL_REVIEW");
    expect(decision.reason).toBe("CRITERIA_NOT_MET");
    expect(decision.otherIssues.map((issue) => issue.code)).toContain("MISSING_DOCUMENTS");
  });

  it("never treats Unclear as ready to submit", () => {
    const decision = bucketRun({
      confidenceThreshold: threshold,
      approvalRequired: true,
      hasCriteria: true,
      channel: "api",
      criteria: [met("2a"), { ...met("2b"), result: "UNCLEAR", failureClass: "documents" }],
    });
    expect(decision).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS" });
  });

  it("treats patient-reported therapy as a missing document", () => {
    const decision = bucketRun({
      confidenceThreshold: threshold,
      approvalRequired: true,
      hasCriteria: true,
      channel: "api",
      criteria: [{ ...met("pt", 0.99), sourceKind: "patient_reported", label: "PT" }],
    });
    expect(decision).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS" });
  });

  it("sends the third missing-document pass to a nurse", () => {
    const decision = bucketRun({
      confidenceThreshold: threshold,
      approvalRequired: true,
      hasCriteria: true,
      priorMissingDocumentsEntries: 2,
      requestedItems: ["PT notes"],
      requestedDates: "Nov 1, Nov 4, Nov 8",
      criteria: [{ ...met("pt"), result: "UNCLEAR", failureClass: "documents", label: "PT notes" }],
    });
    expect(decision).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "REPEATED_REQUESTS", rule: "6" });
    expect(decision.otherIssues.map((issue) => issue.code)).toContain("MISSING_DOCUMENTS");
  });

  it("submits an API packet and parks a portal packet for upload", () => {
    const criteria = [met("2a"), { ...met("2b"), result: "WAIVED" as const }, { ...met("2d"), result: "EXCEPTION_MET" as const }];
    expect(bucketRun({ criteria, approvalRequired: true, hasCriteria: true, channel: "api", insurer: "Federation Health" }).reason).toBe("INITIAL_REQUEST");
    expect(bucketRun({ criteria, approvalRequired: true, hasCriteria: true, channel: "portal", insurer: "Ferengi Benefit Group", attachmentCount: 5 })).toMatchObject({
      status: "NEEDS_ADMIN_REVIEW",
      reason: "PORTAL_UPLOAD",
    });
  });

  it("asks a nurse to confirm after a coordinator fix when the routing policy says so", () => {
    const criteria = [met("2a"), met("2b")];
    const signoff = bucketRun({
      criteria,
      approvalRequired: true,
      hasCriteria: true,
      channel: "api",
      coordinatorFix: true,
      resolvedItem: "PT notes",
      routingPolicy: { version: "v", rules: [{ mode: "nurse_signoff" }] },
    });
    expect(signoff).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "CONFIRM_AFTER_FIX", confirmOnly: true });
    const straight = bucketRun({
      criteria,
      approvalRequired: true,
      hasCriteria: true,
      channel: "api",
      coordinatorFix: true,
      routingPolicy: { version: "v", rules: [{ mode: "straight_to_submission" }] },
    });
    expect(straight.status).toBe("SUBMITTED");
  });
});

describe("who can move an order", () => {
  it("stops the system from setting Denied", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "NEEDS_CLINICAL_REVIEW", reason: "DENIED_DECIDE_APPEAL" });
    expect(() =>
      transitionOrder(state, order.id, "DENIED", { actor: system, expectedVersion: 1, reason: "NO_APPEAL", detail: EXAMPLE_DETAILS.NO_APPEAL }),
    ).toThrow(/system can't set Denied/);
  });

  it("stops the system from cancelling unless Epic says the order was cancelled", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "PROCESSING", step: "INTAKE" });
    expect(() =>
      transitionOrder(state, order.id, "CANCELLED", { actor: system, expectedVersion: 1, reason: "EPIC_CANCELLED", detail: EXAMPLE_DETAILS.EPIC_CANCELLED }),
    ).toThrow(/Epic reports/);
    const cancelled = transitionOrder(state, order.id, "CANCELLED", {
      actor: system,
      expectedVersion: 1,
      reason: "EPIC_CANCELLED",
      detail: EXAMPLE_DETAILS.EPIC_CANCELLED,
      epicCancelled: true,
    });
    expect(cancelled.reason).toBe("EPIC_CANCELLED");
  });

  it("stops a coordinator from approving for submission", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "NEEDS_CLINICAL_REVIEW", reason: "CRITERIA_NOT_MET" });
    expect(() =>
      transitionOrder(state, order.id, "PROCESSING", {
        actor: coordinator,
        expectedVersion: 1,
        reason: null,
        step: "SUBMITTING",
        note: "Looks fine",
        trigger: "approve_for_submission",
      }),
    ).toThrow(/coordinator can't approve/);
  });

  it("stops a nurse from confirming a portal upload", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD", channel: "portal" });
    expect(() =>
      transitionOrder(state, order.id, "SUBMITTED", {
        actor: nurse,
        expectedVersion: 1,
        reason: "INITIAL_REQUEST",
        detail: EXAMPLE_DETAILS.INITIAL_REQUEST,
        portalReference: "PORTAL-9",
      }),
    ).toThrow(/nurse can't confirm a portal upload/);
  });

  it("stops a coordinator from editing criterion results", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "NEEDS_ADMIN_REVIEW", reason: "MISSING_DOCUMENTS" });
    expect(() =>
      transitionOrder(state, order.id, "PROCESSING", {
        actor: coordinator,
        expectedVersion: 1,
        reason: null,
        step: "INTAKE",
        mutateCriteria: true,
        criterionResults: [met("2a")],
      }),
    ).toThrow(/can't edit criterion results/);
  });
});

describe("case summary", () => {
  it("fills every reason template and shows only that role's actions", () => {
    for (const code of REASON_CODES) {
      const explanation = explainReason(code, EXAMPLE_DETAILS[code]);
      const todo = whatToDo(code, EXAMPLE_DETAILS[code]);
      expect(unfilledPlaceholders(explanation), code).toEqual([]);
      expect(unfilledPlaceholders(todo), code).toEqual([]);
      const summary = buildCaseSummary({
        status: statusFor(code),
        reason: code,
        step: null,
        detail: EXAMPLE_DETAILS[code],
        otherIssues: [],
        role: "coordinator",
        actions: renderActions({ reason: code }, "coordinator"),
      });
      const nurseActions = actionsFor({ reason: code }, "nurse").map((action) => action.to);
      const coordinatorActions = actionsFor({ reason: code }, "coordinator").map((action) => action.to);
      expect(summary.actions.every((action) => coordinatorActions.includes(action.to) || action.to === null)).toBe(true);
      if (statusFor(code) === "NEEDS_CLINICAL_REVIEW") expect(coordinatorActions).toEqual([]);
      if (statusFor(code) === "NEEDS_ADMIN_REVIEW") expect(nurseActions.filter((to) => to === "SUBMITTED")).toEqual([]);
      expect(summary.actions.filter((action) => action.primary)).toHaveLength(summary.actions.length === 0 ? 0 : 1);
    }
  });

  it("falls back when a rewritten summary adds a number or date", () => {
    const detail = EXAMPLE_DETAILS.INITIAL_REQUEST;
    const template = explainReason("INITIAL_REQUEST", detail);
    expect(guardSummary(template.replace("Sent", "Submitted"), detail, template)).toBe(template.replace("Sent", "Submitted"));
    expect(guardSummary(template.replace("Nov 9", "Dec 1"), detail, template)).toBe(template);
    expect(guardSummary(`${template} Page 44 was blank.`, detail, template)).toBe(template);
  });
});

describe("migration", () => {
  it("maps the old statuses and leaves them unwritable", () => {
    expect(migrateOrder({ status: "EVALUATING" })).toEqual({ status: "PROCESSING", reason: null, step: "EVALUATING" });
    expect(migrateOrder({ status: "READY_TO_SUBMIT", channel: "api" })).toEqual({ status: "PROCESSING", reason: null, step: "SUBMITTING" });
    expect(migrateOrder({ status: "READY_TO_SUBMIT", channel: "portal" })).toEqual({ status: "NEEDS_ADMIN_REVIEW", reason: "PORTAL_UPLOAD", step: null });
    expect(migrateOrder({ status: "NEEDS_CORRECTION", blockingChecks: ["CO-1"] }).reason).toBe("SIDE_MISMATCH");
    expect(migrateOrder({ status: "NEEDS_CORRECTION", blockingChecks: ["MA-3"] }).reason).toBe("WRONG_PATIENT_PAGE");
    expect(migrateOrder({ status: "NEEDS_CORRECTION", blockingChecks: ["CV-1"] }).reason).toBe("INSURER_MISMATCH");
    expect(migrateOrder({ status: "NEEDS_CORRECTION", blockingChecks: ["CO-2"] }).reason).toBe("CPT_MISMATCH");
    expect(migrateOrder({ status: "CLINICAL_REVIEW", confirmOnly: true }).reason).toBe("CONFIRM_AFTER_FIX");
    expect(migrateOrder({ status: "CLINICAL_REVIEW", repeatedRequests: true }).reason).toBe("REPEATED_REQUESTS");
    expect(migrateOrder({ status: "DENIED" })).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "DENIED_DECIDE_APPEAL" });
    expect(migrateOrder({ status: "CLOSED_DENIED" })).toMatchObject({ status: "DENIED", reason: "NO_APPEAL" });
    expect(migrateOrder({ status: "APPEAL" })).toMatchObject({ status: "SUBMITTED", reason: "APPEAL" });
    expect(isWritableStatus("CLINICAL_REVIEW")).toBe(false);
    expect(isWritableStatus("NEEDS_CLINICAL_REVIEW")).toBe(true);
    const state = new AuthState();
    const order = createOrder(state, { status: "PROCESSING", step: "INTAKE" });
    transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
      actor: system,
      expectedVersion: 1,
      reason: "UNREADABLE_DOCUMENT",
      detail: EXAMPLE_DETAILS.UNREADABLE_DOCUMENT,
    });
    const audit = readAudits(state, { orderId: order.id })[0];
    audit.fromStatus = "UNREADABLE";
    expect(audit.fromStatus).toBe("UNREADABLE");
    expect(isWritableStatus(audit.fromStatus)).toBe(false);
  });
});

describe("library cases", () => {
  it("lands each of the 23 cases on the expected status and reason", () => {
    expect(CASE_FIXTURES).toHaveLength(23);
    for (const fixture of CASE_FIXTURES) {
      const run = runCase(fixture);
      expect(run.status, fixture.name).toBe(fixture.expected);
      expect(run.reason, fixture.name).toBe(fixture.expectedReason);
    }
    const urgent = CASE_FIXTURES.filter((fixture) => fixture.caseNumber === 4 || fixture.caseNumber === 23);
    expect(urgent.every((fixture) => fixture.urgent && runCase(fixture).reason === "INITIAL_REQUEST")).toBe(true);
    expect(runCase(CASE_FIXTURES.find((fixture) => fixture.caseNumber === 16)!).linkedApproval).toBe(true);
  });
});

describe("routing specificity", () => {
  const policy: RoutingPolicy = {
    version: "route-4",
    rules: [
      { mode: "straight_to_submission" },
      { mode: "nurse_signoff", hospital: "Pilot" },
      { mode: "nurse_if_changed", insurer: "Ferengi Benefit Group" },
      { mode: "straight_to_submission", studyType: "PET" },
      { mode: "nurse_signoff", failureType: "CO-4" },
    ],
  };

  it("picks the most specific routing scope", () => {
    const ctx = { failureType: "CO-4", studyType: "PET", insurer: "Ferengi Benefit Group", hospital: "Pilot" };
    expect(resolveRouting(policy, ctx).mode).toBe("nurse_signoff");
    expect(resolveRouting(policy, { studyType: "PET", insurer: "Ferengi Benefit Group", hospital: "Pilot" }).mode).toBe("straight_to_submission");
    expect(resolveRouting(policy, { insurer: "Ferengi Benefit Group", hospital: "Pilot" }).mode).toBe("nurse_if_changed");
    expect(resolveRouting(policy, { hospital: "Pilot" }).mode).toBe("nurse_signoff");
    expect(resolveRouting(policy, {}).mode).toBe("straight_to_submission");
  });
});

describe("wrong-patient page", () => {
  it("quarantines the page and moves the order to admin review", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "PROCESSING", step: "MATCHING" });
    const fax = createDocument(state, { orderId: order.id, status: "PRE_PROCESSED", pageNumbers: [1, 2, 3] });
    const result = quarantineWrongPatientPage(state, order.id, fax.id, 3, {
      actor: system,
      expectedVersion: fax.statusVersion,
      orderVersion: order.statusVersion,
      reason: null,
      detail: { page: 3, name: "Rom", dob: "01/11/1975", sender: "the clinic" },
      note: "Page 3 is for another patient",
    });
    expect(result.order).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "WRONG_PATIENT_PAGE" });
    expect(result.quarantined.pageNumbers).toEqual([3]);
    expect(documentsForPacket(state, order.id).some((doc) => doc.status === "QUARANTINED")).toBe(false);
    expect(readEffects(state).some((effect) => effect.type === "privacy_report")).toBe(true);
  });
});

describe("status catalog", () => {
  it("matches the README section generated from the transition map", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    const start = readme.indexOf("<!-- status-catalog:start -->");
    const end = readme.indexOf("<!-- status-catalog:end -->");
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start + "<!-- status-catalog:start -->".length, end).trim();
    expect(section).toBe(renderStatusCatalog().trim());
  });

  it("keeps the migration in step with the status enums", () => {
    const sql = readFileSync(resolve(root, "db/migrations/002_simplify_order_status.sql"), "utf8");
    for (const status of ORDER_STATUSES) expect(sql).toContain(`'${status}'`);
    expect(sql).toContain("'READY_TO_SUBMIT'");
    expect(sql).toContain("'CLINICAL_REVIEW'");
    expect(sql).toContain("status_audit");
  });
});

function statusFor(code: ReasonCode): OrderStatus {
  if (code === "UNREADABLE_DOCUMENT" || code === "NO_MATCH" || code === "MISSING_DOCUMENTS" || code === "SIDE_MISMATCH" || code === "WRONG_PATIENT_PAGE" || code === "INSURER_MISMATCH" || code === "CPT_MISMATCH" || code === "PORTAL_UPLOAD" || code === "MEMBER_ID_MISSING" || code === "RETURN_TO_PROVIDER" || code === "SUBMISSION_FAILED" || code === "MORE_INFO_REQUESTED" || code === "STATUS_CHECK_FAILED" || code === "APPROVAL_MISMATCH" || code === "WRITEBACK_FAILED") {
    return "NEEDS_ADMIN_REVIEW";
  }
  if (code === "CRITERIA_NOT_MET" || code === "RULE_GAP" || code === "CONFIRM_AFTER_FIX" || code === "REPEATED_REQUESTS" || code === "DENIED_DECIDE_APPEAL" || code === "PEER_TO_PEER") {
    return "NEEDS_CLINICAL_REVIEW";
  }
  if (code === "INITIAL_REQUEST" || code === "AWAITING_DECISION" || code === "PENDED_BY_INSURER" || code === "APPEAL") return "SUBMITTED";
  if (code === "NEW" || code === "LINKED_EXISTING" || code === "APPEAL_WON") return "APPROVED";
  if (code === "NOT_ON_PA_LIST" || code === "SETTING_EXEMPT") return "NOT_REQUIRED";
  if (code === "NO_APPEAL" || code === "APPEAL_LOST") return "DENIED";
  return "CANCELLED";
}

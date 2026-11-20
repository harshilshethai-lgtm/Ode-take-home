import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthState,
  CASE_FIXTURES,
  DOCUMENT_STATUSES,
  IllegalTransitionError,
  ORDER_STATUSES,
  StaleVersionError,
  TransitionDeniedError,
  correctionDestination,
  createDocument,
  createOrder,
  decideEvaluating,
  documentsForPacket,
  isLegalDocumentTransition,
  isLegalOrderTransition,
  ownerRole,
  primaryActionLabel,
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
  type Actor,
  type CriterionResult,
  type DocumentStatus,
  type OrderStatus,
  type RoutingPolicy,
  type TransitionContext,
} from "./index";

const root = resolve(__dirname, "../../..");
const system: Actor = { kind: "system" };
const coordinator: Actor = { kind: "user", id: "p-jasmine", role: "coordinator", permissions: ["cancel"] };
const nurse: Actor = { kind: "user", id: "p-priya", role: "nurse", permissions: ["cancel"] };
const approval = { number: "A-100", cpt: "72148", validFrom: "2026-11-01", validTo: "2027-02-01" };

function actorFor(from: OrderStatus, to: OrderStatus): Actor {
  if (to === "CANCELLED") return coordinator;
  if (to === "CLOSED_DENIED" || from === "DENIED" || from === "APPEAL" || from === "CLINICAL_REVIEW" || from === "RULE_GAP") return nurse;
  if (from === "SUBMITTED") return system;
  if (ownerRole(from, "api") === "coordinator") return coordinator;
  return system;
}

function contextFor(from: OrderStatus, to: OrderStatus): TransitionContext {
  const ctx: TransitionContext = {
    actor: actorFor(from, to),
    expectedVersion: 1,
    reason: to === "CANCELLED" ? "Slot released" : "Move",
    checkIds: [],
  };
  if (to === "APPROVED") ctx.approval = { ...approval, linked: from === "COVERAGE_CHECK" };
  if ((from === "CLINICAL_REVIEW" || from === "RULE_GAP") && to === "READY_TO_SUBMIT") ctx.note = "Reviewed against the policy";
  if (from === "READY_TO_SUBMIT" && to === "SUBMITTED") ctx.trackingNumber = "TRK-1";
  if (to === "DENIED") ctx.denialReason = "Not medically necessary";
  return ctx;
}

function seedOrder(from: OrderStatus, to: OrderStatus) {
  const state = new AuthState();
  const blockingChecks = from === "NEEDS_CORRECTION" ? (to === "COVERAGE_CHECK" ? ["CV-1"] : ["CO-1"]) : [];
  const order = createOrder(state, {
    status: from,
    channel: "api",
    blockingChecks,
    fixableGaps: from === "CLINICAL_REVIEW" && to === "AWAITING_DOCUMENTS",
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
      const { state, order } = seedOrder(from, to);
      const ctx = contextFor(from, to);
      if (isLegalOrderTransition(from, to)) {
        const next = transitionOrder(state, order.id, to, ctx);
        expect(next.status, `${from} -> ${to}`).toBe(to);
        const audit = readAudits(state, { orderId: order.id }).at(-1);
        expect(audit?.fromStatus).toBe(from);
        expect(audit?.toStatus).toBe(to);
        expect(audit?.actor).toBe(ctx.actor.kind === "system" ? "system" : ctx.actor.id);
      } else {
        let error: unknown;
        try {
          transitionOrder(state, order.id, to, ctx);
        } catch (caught) {
          error = caught;
        }
        expect(error, `${from} -> ${to}`).toBeInstanceOf(IllegalTransitionError);
        expect(error).toMatchObject({ from, to });
      }
    }
  });

  it("rejects every move out of a closed status", () => {
    for (const from of ["APPROVED", "NOT_REQUIRED", "CLOSED_DENIED", "CANCELLED"] as const) {
      for (const to of ORDER_STATUSES) {
        const { state, order } = seedOrder(from, to);
        expect(() => transitionOrder(state, order.id, to, contextFor(from, to))).toThrow(IllegalTransitionError);
      }
    }
  });
});

describe("document transitions", () => {
  const pairs = DOCUMENT_STATUSES.flatMap((from) => DOCUMENT_STATUSES.map((to) => ({ from, to })));

  it("lets every legal pair succeed and rejects every other pair", () => {
    for (const { from, to } of pairs) {
      const state = new AuthState();
      const doc = createDocument(state, { status: from, pageNumbers: [1], orderId: null });
      const ctx: TransitionContext = { actor: system, expectedVersion: 1, reason: "Move", checkIds: [] };
      if (isLegalDocumentTransition(from, to)) {
        expect(transitionDocument(state, doc.id, to, ctx).status).toBe(to);
        expect(readAudits(state, { documentId: doc.id }).at(-1)).toMatchObject({ fromStatus: from, toStatus: to, actor: "system" });
      } else {
        let error: unknown;
        try {
          transitionDocument(state, doc.id, to, ctx);
        } catch (caught) {
          error = caught;
        }
        expect(error, `${from} -> ${to}`).toBeInstanceOf(IllegalTransitionError);
        expect(error).toMatchObject({ from, to });
      }
    }
  });

  it("rejects every move out of a closed document", () => {
    for (const from of ["QUARANTINED", "SUPERSEDED"] as const) {
      for (const to of DOCUMENT_STATUSES) {
        const state = new AuthState();
        const doc = createDocument(state, { status: from as DocumentStatus, pageNumbers: [1] });
        expect(() => transitionDocument(state, doc.id, to, { actor: system, expectedVersion: 1, reason: "Move" })).toThrow(IllegalTransitionError);
      }
    }
  });
});

describe("evaluating decisions", () => {
  const threshold = 0.85;

  it("lets a consistency failure beat a clinical failure and a missing document", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      consistencyFailures: [{ id: "CO-1", detail: "Request says LEFT knee; office note says RIGHT" }],
      criteria: [{ ...met("2a"), result: "NOT_MET", failureClass: "clinical" }, { ...met("2b"), result: "UNCLEAR", failureClass: "documents" }],
    });
    expect(decision).toMatchObject({ status: "NEEDS_CORRECTION", rule: "E1", checkIds: ["CO-1"] });
  });

  it("sends clinical NOT_MET plus a missing document to clinical review", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      criteria: [
        { ...met("pain"), result: "NOT_MET", failureClass: "clinical", label: "3 weeks of symptoms (needs 6)" },
        { ...met("pt"), result: "UNCLEAR", failureClass: "documents", label: "PT notes" },
      ],
    });
    expect(decision.status).toBe("CLINICAL_REVIEW");
    expect(decision.reason).toContain("3 weeks of symptoms");
    expect(decision.reason).toContain("PT notes");
  });

  it("never treats UNCLEAR as ready to submit", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      criteria: [met("2a"), { ...met("2b"), result: "UNCLEAR", failureClass: "documents" }],
    });
    expect(decision.status).toBe("AWAITING_DOCUMENTS");
    expect(decision.status).not.toBe("READY_TO_SUBMIT");
  });

  it("treats patient-reported therapy as a document gap", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      criteria: [{ ...met("pt", 0.99), sourceKind: "patient_reported", label: "PT" }],
    });
    expect(decision.status).toBe("AWAITING_DOCUMENTS");
    expect(decision.rule).toBe("E3");
  });

  it("treats a MET result below its threshold as UNCLEAR", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      criteria: [met("2a"), met("2b", 0.5)],
    });
    expect(decision.status).toBe("AWAITING_DOCUMENTS");
  });

  it("submits when every criterion is met, waived or an exception, all above threshold", () => {
    const decision = decideEvaluating({
      confidenceThreshold: threshold,
      criteria: [
        met("2a"),
        { ...met("2b"), result: "WAIVED" },
        { ...met("2d"), result: "EXCEPTION_MET" },
      ],
    });
    expect(decision).toMatchObject({ status: "READY_TO_SUBMIT", rule: "E4", confirmOnly: false });
  });
});

describe("routing after a coordinator fix", () => {
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
  const criteria = [met("2a"), met("2b")];
  const previous = [{ ...met("2a"), result: "UNCLEAR" as const, failureClass: "documents" as const }, met("2b")];

  function routed(modeContext: Parameters<typeof resolveRouting>[1], extra: Partial<Parameters<typeof decideEvaluating>[0]> = {}) {
    return decideEvaluating({
      confidenceThreshold: 0.85,
      criteria,
      coordinatorFixSinceApprovalCheck: true,
      routingPolicy: { version: "route-4", rules: [{ mode: "nurse_signoff" }] },
      resolvedItem: "PT notes",
      ...extra,
      routingContext: modeContext,
    });
  }

  it("follows each mode", () => {
    expect(routed({}, { routingPolicy: { version: "v", rules: [{ mode: "straight_to_submission" }] } }).status).toBe("READY_TO_SUBMIT");
    const signoff = routed({}, { routingPolicy: { version: "v", rules: [{ mode: "nurse_signoff" }] } });
    expect(signoff).toMatchObject({ status: "CLINICAL_REVIEW", confirmOnly: true, reason: "Confirm: PT notes received" });
    const changed = decideEvaluating({
      confidenceThreshold: 0.85,
      criteria,
      previousCriteria: previous,
      fixedCriterionIds: ["2a"],
      coordinatorFixSinceApprovalCheck: true,
      resolvedItem: "PT notes",
      routingPolicy: { version: "v", rules: [{ mode: "nurse_if_changed" }] },
    });
    expect(changed.status).toBe("READY_TO_SUBMIT");
    const otherChange = decideEvaluating({
      confidenceThreshold: 0.85,
      criteria: [met("2a"), { ...met("2b"), result: "WAIVED" }],
      previousCriteria: [met("2a"), met("2b")],
      fixedCriterionIds: ["2a"],
      coordinatorFixSinceApprovalCheck: true,
      resolvedItem: "PT notes",
      routingPolicy: { version: "v", rules: [{ mode: "nurse_if_changed" }] },
    });
    expect(otherChange).toMatchObject({ status: "CLINICAL_REVIEW", confirmOnly: true });
  });

  it("does not reroute a clean case that never needed a coordinator", () => {
    const decision = decideEvaluating({
      confidenceThreshold: 0.85,
      criteria,
      coordinatorFixSinceApprovalCheck: false,
      routingPolicy: { version: "v", rules: [{ mode: "nurse_signoff" }] },
    });
    expect(decision.status).toBe("READY_TO_SUBMIT");
  });

  it("picks the most specific routing scope", () => {
    const ctx = { failureType: "CO-4", studyType: "PET", insurer: "Ferengi Benefit Group", hospital: "Pilot" };
    expect(resolveRouting(policy, ctx).mode).toBe("nurse_signoff");
    expect(resolveRouting(policy, { studyType: "PET", insurer: "Ferengi Benefit Group", hospital: "Pilot" }).mode).toBe("straight_to_submission");
    expect(resolveRouting(policy, { insurer: "Ferengi Benefit Group", hospital: "Pilot" }).mode).toBe("nurse_if_changed");
    expect(resolveRouting(policy, { hospital: "Pilot" }).mode).toBe("nurse_signoff");
    expect(resolveRouting(policy, {}).mode).toBe("straight_to_submission");
  });
});

describe("loop guard", () => {
  const gap = { confidenceThreshold: 0.85, criteria: [{ ...met("pt"), result: "UNCLEAR" as const, failureClass: "documents" as const, label: "PT notes" }], requestedItems: ["PT notes, Utopia Planitia Rehab"] };

  it("enters awaiting documents the first two times and clinical review the third", () => {
    expect(decideEvaluating({ ...gap, priorAwaitingDocumentsEntries: 0 }).status).toBe("AWAITING_DOCUMENTS");
    expect(decideEvaluating({ ...gap, priorAwaitingDocumentsEntries: 1 }).status).toBe("AWAITING_DOCUMENTS");
    const third = decideEvaluating({ ...gap, priorAwaitingDocumentsEntries: 2 });
    expect(third).toMatchObject({ status: "CLINICAL_REVIEW", rule: "E6" });
    expect(third.reason).toBe("Documents requested 3 times: PT notes, Utopia Planitia Rehab");
  });
});

describe("who can move an order", () => {
  it("stops a coordinator from triggering a nurse transition", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "CLINICAL_REVIEW" });
    expect(() =>
      transitionOrder(state, order.id, "READY_TO_SUBMIT", { actor: coordinator, expectedVersion: 1, reason: "Submit", note: "Looks fine" }),
    ).toThrow(TransitionDeniedError);
  });

  it("stops a nurse from confirming a portal upload", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "READY_TO_SUBMIT", channel: "portal" });
    expect(() =>
      transitionOrder(state, order.id, "SUBMITTED", { actor: nurse, expectedVersion: 1, reason: "Uploaded", portalReference: "PORTAL-9" }),
    ).toThrow(/nurse can't confirm a portal upload/);
  });

  it("stops the system from setting closed denied", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "DENIED" });
    expect(() => transitionOrder(state, order.id, "CLOSED_DENIED", { actor: system, expectedVersion: 1, reason: "Final" })).toThrow(/system can't set Closed denied/);
  });

  it("stops a coordinator from editing criterion results", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "AWAITING_DOCUMENTS" });
    expect(() =>
      transitionOrder(state, order.id, "COLLECTING_EVIDENCE", {
        actor: coordinator,
        expectedVersion: 1,
        reason: "Documents received",
        mutateCriteria: true,
        criterionResults: [met("2a")],
      }),
    ).toThrow(/can't edit criterion results/);
  });
});

describe("approved", () => {
  it("is blocked until the approval number, CPT and dates are present", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "COVERAGE_CHECK" });
    const base = { actor: system, expectedVersion: 1, reason: "Approved", checkIds: ["CV-2"] as string[] };
    expect(() => transitionOrder(state, order.id, "APPROVED", { ...base, approval: { ...approval, number: "" } })).toThrow(/approval number/);
    expect(() => transitionOrder(state, order.id, "APPROVED", { ...base, approval: { ...approval, cpt: " " } })).toThrow(/approval number/);
    expect(() => transitionOrder(state, order.id, "APPROVED", { ...base, approval: { ...approval, validFrom: "" } })).toThrow(/approval number/);
    expect(() => transitionOrder(state, order.id, "APPROVED", { ...base, approval: { ...approval, validTo: "" } })).toThrow(/approval number/);
    const approved = transitionOrder(state, order.id, "APPROVED", { ...base, approval: { ...approval, linked: true } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.linkedApproval).toBe(true);
    expect(readAudits(state, { orderId: order.id }).at(-1)?.reason).toBe("Linked existing approval A-100");
  });
});

describe("wrong-patient page", () => {
  it("quarantines that page, corrects the order, and keeps the page out of the packet", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "MATCHING" });
    const fax = createDocument(state, { orderId: order.id, status: "PRE_PROCESSED", pageNumbers: [1, 2, 3] });
    const result = quarantineWrongPatientPage(state, order.id, fax.id, 3, {
      actor: system,
      expectedVersion: fax.statusVersion,
      orderVersion: order.statusVersion,
      reason: "Page 3 is for another patient (ROM, DOB 01/11/1975); quarantined",
      checkIds: ["MA-3"],
    });
    expect(result.order.status).toBe("NEEDS_CORRECTION");
    expect(result.order.blockingChecks).toEqual(["MA-3"]);
    expect(result.quarantined.status).toBe("QUARANTINED");
    expect(result.quarantined.pageNumbers).toEqual([3]);
    expect(result.remainder?.status).toBe("PRE_PROCESSED");
    expect(result.remainder?.pageNumbers).toEqual([1, 2]);
    expect(readEffects(state).some((effect) => effect.type === "privacy_report" && effect.documentId === result.quarantined.id)).toBe(true);

    const attached = transitionDocument(state, result.remainder!.id, "ATTACHED", {
      actor: system,
      expectedVersion: result.remainder!.statusVersion,
      reason: "Matched to the order",
    });
    const packet = documentsForPacket(state, order.id);
    expect(packet.map((doc) => doc.id)).toEqual([attached.id]);
    expect(packet.some((doc) => doc.status === "QUARANTINED")).toBe(false);
  });
});

describe("needs correction", () => {
  it("returns to coverage for CV-1 and CO-5, and to collecting evidence otherwise", () => {
    expect(correctionDestination(["CV-1"])).toBe("COVERAGE_CHECK");
    expect(correctionDestination(["CO-5"])).toBe("COVERAGE_CHECK");
    expect(correctionDestination(["CV-1", "CO-5"])).toBe("COVERAGE_CHECK");
    expect(correctionDestination(["CO-1"])).toBe("COLLECTING_EVIDENCE");
    expect(correctionDestination(["MA-3"])).toBe("COLLECTING_EVIDENCE");
    expect(correctionDestination(["CO-2", "CV-1"])).toBe("COLLECTING_EVIDENCE");

    const state = new AuthState();
    const wrongCoverage = createOrder(state, { status: "NEEDS_CORRECTION", blockingChecks: ["CV-1"] });
    expect(() => transitionOrder(state, wrongCoverage.id, "COLLECTING_EVIDENCE", { actor: coordinator, expectedVersion: 1, reason: "Wrong return" })).toThrow(TransitionDeniedError);
    expect(transitionOrder(state, wrongCoverage.id, "COVERAGE_CHECK", { actor: coordinator, expectedVersion: 1, reason: "Correction made" }).status).toBe("COVERAGE_CHECK");

    const side = createOrder(state, { status: "NEEDS_CORRECTION", blockingChecks: ["CO-1"] });
    expect(() => transitionOrder(state, side.id, "COVERAGE_CHECK", { actor: coordinator, expectedVersion: 1, reason: "Wrong return" })).toThrow(TransitionDeniedError);
    expect(transitionOrder(state, side.id, "COLLECTING_EVIDENCE", { actor: coordinator, expectedVersion: 1, reason: "Correction made" }).status).toBe("COLLECTING_EVIDENCE");
  });
});

describe("optimistic locking", () => {
  it("keeps the first of two simultaneous transitions and fails the stale one", () => {
    const state = new AuthState();
    const order = createOrder(state, { status: "RECEIVED" });
    const version = order.statusVersion;
    const first = transitionOrder(state, order.id, "PRE_PROCESSING", { actor: system, expectedVersion: version, reason: "Checking 4 pages" });
    expect(first.statusVersion).toBe(2);
    expect(() =>
      transitionOrder(state, order.id, "CANCELLED", { actor: coordinator, expectedVersion: version, reason: "Duplicate click" }),
    ).toThrow(StaleVersionError);
    expect(readOrder(state, order.id).status).toBe("PRE_PROCESSING");
  });
});

describe("library cases", () => {
  it("reaches the expected status before the insurer step", () => {
    const expected: Record<number, OrderStatus> = {
      1: "READY_TO_SUBMIT",
      4: "READY_TO_SUBMIT",
      5: "READY_TO_SUBMIT",
      7: "READY_TO_SUBMIT",
      9: "READY_TO_SUBMIT",
      14: "READY_TO_SUBMIT",
      22: "READY_TO_SUBMIT",
      23: "READY_TO_SUBMIT",
      2: "AWAITING_DOCUMENTS",
      12: "AWAITING_DOCUMENTS",
      13: "AWAITING_DOCUMENTS",
      3: "CLINICAL_REVIEW",
      6: "CLINICAL_REVIEW",
      8: "CLINICAL_REVIEW",
      10: "CLINICAL_REVIEW",
      11: "NOT_REQUIRED",
      21: "NOT_REQUIRED",
      15: "NEEDS_CORRECTION",
      17: "NEEDS_CORRECTION",
      18: "NEEDS_CORRECTION",
      16: "APPROVED",
      19: "RULE_GAP",
      20: "UNREADABLE",
    };
    expect(CASE_FIXTURES).toHaveLength(23);
    for (const fixture of CASE_FIXTURES) {
      const run = runCase(fixture);
      expect(run.status, fixture.name).toBe(expected[fixture.caseNumber]);
      expect(run.status, fixture.name).toBe(fixture.expected);
    }
    const yar = runCase(CASE_FIXTURES.find((fixture) => fixture.caseNumber === 16)!);
    expect(yar.linkedApproval).toBe(true);
    expect(yar.reason).toContain("FH-AUTH-2026-118842");
  });
});

describe("worklist rendering", () => {
  it("shows the owner role its primary action and disables an upload without a reference", () => {
    const portal = createOrder(new AuthState(), { status: "READY_TO_SUBMIT", channel: "portal" });
    expect(primaryActionLabel(portal, "coordinator")).toBe("Open packet");
    expect(primaryActionLabel(portal, "nurse")).toBeNull();
    const uploaded = renderActions(portal, "coordinator", {});
    expect(uploaded.find((action) => action.label === "Uploaded")).toMatchObject({ disabled: true, disabledReason: "Enter the portal reference number" });
    expect(renderActions(portal, "coordinator", { portalReference: "FG-22" }).find((action) => action.id === "uploaded")?.disabled).toBe(false);

    const review = createOrder(new AuthState(), { status: "CLINICAL_REVIEW", confirmOnly: true, fixableGaps: true });
    expect(primaryActionLabel(review, "nurse")).toBe("Approve for submission");
    expect(primaryActionLabel(review, "coordinator")).toBeNull();
    expect(renderActions(review, "nurse", {}).find((action) => action.id === "approve_for_submission")?.disabled).toBe(true);
    expect(renderActions(review, "nurse", { note: "Confirmed" }).find((action) => action.id === "approve_for_submission")?.disabled).toBe(false);
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
    const sql = readFileSync(resolve(root, "db/migrations/001_prior_auth_status.sql"), "utf8");
    for (const status of ORDER_STATUSES) expect(sql).toContain(`'${status}'`);
    for (const status of ["PRE_PROCESSED", "ATTACHED", "QUARANTINED", "SUPERSEDED"]) expect(sql).toContain(`'${status}'`);
    expect(sql).toContain("status_version");
    expect(sql).toContain("status_audit");
    expect(sql).toContain("criterion_results");
  });
});

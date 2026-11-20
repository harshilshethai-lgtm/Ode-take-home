import { CLOSED_DOCUMENT_STATUSES, DEFAULT_FOLLOW_UP, isLegalDocumentTransition, isLegalOrderTransition, resumeStepFor } from "./catalog";
import { explainReason, reasonChip, reasonFits, stepProgress } from "./reasons";
import { unfilledPlaceholders } from "./summary";
import type {
  Actor,
  ApprovalInput,
  AuditRow,
  Channel,
  CriterionResult,
  DocumentSnapshot,
  DocumentStatus,
  Effect,
  OrderSnapshot,
  OrderStatus,
  OtherIssue,
  ProcessingStep,
  ReasonCode,
  ReasonDetail,
  TransitionContext,
} from "./types";
import { IllegalTransitionError, StaleVersionError, TransitionDeniedError } from "./types";

interface OrderData extends OrderSnapshot {}
interface DocumentData extends DocumentSnapshot {}

interface Internal {
  orders: Map<string, OrderData>;
  documents: Map<string, DocumentData>;
  audits: AuditRow[];
  effects: Effect[];
  seq: number;
}

const internals = new WeakMap<AuthState, Internal>();

/** In-memory stand-in for the status tables. The status column is written only by transitionOrder. */
export class AuthState {
  constructor() {
    internals.set(this, { orders: new Map(), documents: new Map(), audits: [], effects: [], seq: 1 });
  }
}

function db(state: AuthState): Internal {
  const found = internals.get(state);
  if (!found) throw new Error("Unknown auth state");
  return found;
}

function nextId(state: AuthState, prefix: string): string {
  const data = db(state);
  const id = `${prefix}_${data.seq}`;
  data.seq += 1;
  return id;
}

export function createOrder(
  state: AuthState,
  input: {
    id?: string;
    status?: OrderStatus;
    channel?: Channel | null;
    reason?: ReasonCode | null;
    step?: ProcessingStep | null;
    detail?: ReasonDetail;
    otherIssues?: OtherIssue[];
    missingDocumentsEntries?: number;
    submissionAttempts?: number;
    confirmOnly?: boolean;
    linkedApproval?: boolean;
    approval?: ApprovalInput | null;
    blockingChecks?: string[];
    fixableGaps?: boolean;
    scanCompleted?: boolean;
    now?: Date;
  } = {},
): OrderSnapshot {
  const data = db(state);
  const status = input.status ?? "PROCESSING";
  const reason = input.reason === undefined ? (status === "PROCESSING" ? null : null) : input.reason;
  if (!reasonFits(status, reason)) {
    throw new TransitionDeniedError(`Reason ${reason ?? "none"} is not valid for ${status}`);
  }
  const order: OrderData = {
    id: input.id ?? nextId(state, "ord"),
    status,
    statusVersion: 1,
    channel: input.channel ?? null,
    reason,
    step: status === "PROCESSING" ? (input.step ?? "INTAKE") : null,
    detail: { ...(input.detail ?? {}) },
    otherIssues: (input.otherIssues ?? []).map(copyIssue),
    missingDocumentsEntries: input.missingDocumentsEntries ?? 0,
    resumeStep: null,
    submissionAttempts: input.submissionAttempts ?? 0,
    confirmOnly: input.confirmOnly ?? reason === "CONFIRM_AFTER_FIX",
    linkedApproval: input.linkedApproval ?? reason === "LINKED_EXISTING",
    approval: input.approval ? { ...input.approval } : null,
    blockingChecks: [...(input.blockingChecks ?? checksFor(reason))],
    fixableGaps: input.fixableGaps ?? false,
    scanCompleted: input.scanCompleted ?? false,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  data.orders.set(order.id, order);
  return copyOrder(order);
}

export function createDocument(
  state: AuthState,
  input: {
    id?: string;
    orderId?: string | null;
    status?: DocumentStatus;
    pageNumbers: number[];
    parentDocumentId?: string | null;
    now?: Date;
  },
): DocumentSnapshot {
  const data = db(state);
  const doc: DocumentData = {
    id: input.id ?? nextId(state, "doc"),
    orderId: input.orderId ?? null,
    status: input.status ?? "RECEIVED",
    statusVersion: 1,
    pageNumbers: [...input.pageNumbers],
    parentDocumentId: input.parentDocumentId ?? null,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  data.documents.set(doc.id, doc);
  return copyDocument(doc);
}

export function readOrder(state: AuthState, orderId: string): OrderSnapshot {
  return copyOrder(mustOrder(state, orderId));
}

export function readDocument(state: AuthState, docId: string): DocumentSnapshot {
  return copyDocument(mustDocument(state, docId));
}

export function readAudits(state: AuthState, subject: { orderId?: string; documentId?: string }): AuditRow[] {
  return db(state)
    .audits.filter((row) => (subject.orderId === undefined || row.orderId === subject.orderId) && (subject.documentId === undefined || row.documentId === subject.documentId))
    .map(copyAudit);
}

export function readEffects(state: AuthState): Effect[] {
  return db(state).effects.map((effect) => ({ ...effect }));
}

export function documentsForOrder(state: AuthState, orderId: string): DocumentSnapshot[] {
  return [...db(state).documents.values()].filter((doc) => doc.orderId === orderId).map(copyDocument);
}

/** Only ATTACHED documents may go into a submission packet. */
export function documentsForPacket(state: AuthState, orderId: string): DocumentSnapshot[] {
  return documentsForOrder(state, orderId).filter((doc) => doc.status === "ATTACHED");
}

/** Time in status comes from the latest audit row that changed status, not a stored duration. */
export function timeInStatusMs(state: AuthState, orderId: string, now: Date): number {
  const order = mustOrder(state, orderId);
  const audits = db(state).audits.filter((row) => row.orderId === orderId && row.fromStatus !== row.toStatus);
  const at = audits.length > 0 ? audits[audits.length - 1].at : order.createdAt;
  return Math.max(0, now.getTime() - new Date(at).getTime());
}

/**
 * The only way to change an order's status.
 * A stale status version throws before any other check. An illegal pair throws IllegalTransitionError.
 */
export function transitionOrder(state: AuthState, orderId: string, to: OrderStatus, ctx: TransitionContext): OrderSnapshot {
  const order = mustOrder(state, orderId);
  if (order.statusVersion !== ctx.expectedVersion) {
    throw new StaleVersionError(ctx.expectedVersion, order.statusVersion);
  }
  if (order.status === to || !isLegalOrderTransition(order.status, to)) {
    throw new IllegalTransitionError(order.status, to);
  }
  if (!reasonFits(to, ctx.reason)) {
    throw new TransitionDeniedError(`Reason ${ctx.reason ?? "none"} is not valid for ${to}`);
  }
  if (to === "PROCESSING" && !ctx.step) {
    throw new TransitionDeniedError("Processing needs a step");
  }

  assertOrderActor(order, to, ctx);
  assertOrderConditions(order, to, ctx);

  const from = order.status;
  const previousReason = order.reason;
  const at = (ctx.now ?? new Date()).toISOString();
  const detail = { ...(ctx.detail ?? {}) };
  order.status = to;
  order.statusVersion += 1;
  order.reason = ctx.reason;
  order.step = to === "PROCESSING" ? (ctx.step ?? "INTAKE") : null;
  order.detail = detail;
  order.otherIssues = (ctx.otherIssues ?? []).map(copyIssue);
  order.confirmOnly = ctx.reason === "CONFIRM_AFTER_FIX";
  order.blockingChecks = [...(ctx.checkIds ?? checksFor(ctx.reason))];
  order.fixableGaps = ctx.fixableGaps === true || (ctx.otherIssues ?? []).some((issue) => issue.code === "MISSING_DOCUMENTS");
  order.resumeStep = to === "PROCESSING" ? (ctx.step ?? resumeStepFor(previousReason)) : null;
  if (ctx.reason === "MISSING_DOCUMENTS") order.missingDocumentsEntries += 1;
  if (ctx.reason === "SUBMISSION_FAILED") order.submissionAttempts = Math.max(order.submissionAttempts, 3);
  if (to === "APPROVED" && ctx.approval) {
    order.approval = { ...ctx.approval };
    order.linkedApproval = ctx.approval.linked === true || ctx.reason === "LINKED_EXISTING";
  }

  const sentence = sentenceFor(to, ctx.reason, ctx.step ?? null, detail);
  writeAudit(state, {
    orderId: order.id,
    documentId: null,
    fromStatus: from,
    toStatus: to,
    actor: actorId(ctx.actor),
    at,
    reason: sentence,
    reasonCode: ctx.reason,
    step: order.step,
    checkIds: [...(ctx.checkIds ?? [])],
    criterionResults: ctx.criterionResults ? ctx.criterionResults.map(copyCriterion) : null,
    evidenceRefs: (ctx.evidenceRefs ?? []).map((ref) => ({ ...ref })),
    ruleVersion: ctx.ruleVersion ?? null,
    routingPolicyVersion: ctx.routingPolicyVersion ?? null,
  });
  recordOrderEffects(state, order, ctx, sentence);
  return copyOrder(order);
}

/**
 * Updates the reason without leaving the status. Used while Submitted, where the
 * insurer's answer changes the reason and the status stays put.
 */
export function applyReason(state: AuthState, orderId: string, ctx: TransitionContext): OrderSnapshot {
  const order = mustOrder(state, orderId);
  if (order.statusVersion !== ctx.expectedVersion) throw new StaleVersionError(ctx.expectedVersion, order.statusVersion);
  if (order.status === "PROCESSING" || !ctx.reason || !reasonFits(order.status, ctx.reason)) {
    throw new TransitionDeniedError(`Reason ${ctx.reason ?? "none"} is not valid for ${order.status}`);
  }
  assertReasonActor(order, ctx);
  const detail = { ...(ctx.detail ?? {}) };
  order.statusVersion += 1;
  order.reason = ctx.reason;
  order.detail = detail;
  order.otherIssues = (ctx.otherIssues ?? order.otherIssues).map(copyIssue);
  order.confirmOnly = ctx.reason === "CONFIRM_AFTER_FIX";
  order.blockingChecks = [...(ctx.checkIds ?? checksFor(ctx.reason))];
  // A reason update stays on the same status, so it is not a transition and writes no activity event.
  recordOrderEffects(state, order, ctx, sentenceFor(order.status, ctx.reason, null, detail));
  return copyOrder(order);
}

/** Epic reported the scan. APPROVED can no longer return to the pipeline. */
export function markScanCompleted(state: AuthState, orderId: string, _now?: Date): OrderSnapshot {
  const order = mustOrder(state, orderId);
  order.scanCompleted = true;
  order.statusVersion += 1;
  return copyOrder(order);
}

/** Moves the progress text without changing the status column. */
export function advanceProcessingStep(state: AuthState, orderId: string, step: ProcessingStep, ctx: Pick<TransitionContext, "actor" | "detail" | "now">): OrderSnapshot {
  const order = mustOrder(state, orderId);
  if (order.status !== "PROCESSING") {
    throw new IllegalTransitionError(order.status, "PROCESSING");
  }
  order.step = step;
  order.detail = { ...order.detail, ...(ctx.detail ?? {}) };
  return copyOrder(order);
}

export function transitionDocument(state: AuthState, docId: string, to: DocumentStatus, ctx: TransitionContext): DocumentSnapshot {
  const doc = mustDocument(state, docId);
  if (doc.statusVersion !== ctx.expectedVersion) {
    throw new StaleVersionError(ctx.expectedVersion, doc.statusVersion);
  }
  if (!isLegalDocumentTransition(doc.status, to)) {
    throw new IllegalTransitionError(doc.status, to);
  }
  assertDocumentActor(ctx);

  const from = doc.status;
  const at = (ctx.now ?? new Date()).toISOString();
  doc.status = to;
  doc.statusVersion += 1;

  writeAudit(state, {
    orderId: doc.orderId,
    documentId: doc.id,
    fromStatus: from,
    toStatus: to,
    actor: actorId(ctx.actor),
    at,
    reason: ctx.note || (ctx.reason ? reasonChip(ctx.reason) : "Document updated"),
    reasonCode: ctx.reason,
    step: null,
    checkIds: [...(ctx.checkIds ?? [])],
    criterionResults: null,
    evidenceRefs: (ctx.evidenceRefs ?? []).map((ref) => ({ ...ref })),
    ruleVersion: ctx.ruleVersion ?? null,
    routingPolicyVersion: ctx.routingPolicyVersion ?? null,
  });

  if (to === "QUARANTINED") {
    db(state).effects.push({ type: "privacy_report", documentId: doc.id, orderId: doc.orderId });
  }
  if (to === "ATTACHED" && doc.orderId) restartForAttachment(state, doc.orderId, ctx);
  return copyDocument(doc);
}

export function splitAndQuarantine(
  state: AuthState,
  docId: string,
  pageNumber: number,
  ctx: TransitionContext,
): { quarantined: DocumentSnapshot; remainder: DocumentSnapshot | null } {
  const parent = mustDocument(state, docId);
  if (!parent.pageNumbers.includes(pageNumber)) {
    throw new TransitionDeniedError(`Page ${pageNumber} is not on document ${docId}`);
  }
  if (CLOSED_DOCUMENT_STATUSES.includes(parent.status as (typeof CLOSED_DOCUMENT_STATUSES)[number])) {
    throw new IllegalTransitionError(parent.status, "QUARANTINED");
  }
  if (parent.pageNumbers.length === 1) {
    const quarantined = transitionDocument(state, parent.id, "QUARANTINED", {
      ...ctx,
      checkIds: ctx.checkIds ?? ["MA-3"],
      note: ctx.note || `Page ${pageNumber} is for another patient; quarantined`,
    });
    return { quarantined, remainder: null };
  }

  const child = createDocument(state, {
    orderId: parent.orderId,
    status: parent.status,
    pageNumbers: [pageNumber],
    parentDocumentId: parent.id,
    now: ctx.now,
  });
  parent.pageNumbers = parent.pageNumbers.filter((page) => page !== pageNumber);
  const quarantined = transitionDocument(state, child.id, "QUARANTINED", {
    actor: { kind: "system" },
    expectedVersion: 1,
    reason: null,
    note: ctx.note || `Page ${pageNumber} is for another patient; quarantined`,
    checkIds: ctx.checkIds ?? ["MA-3"],
    now: ctx.now,
  });
  return { quarantined, remainder: copyDocument(parent) };
}

/** Wrong-patient page: quarantine that page and send the order to admin review. The order must be Processing. */
export function quarantineWrongPatientPage(
  state: AuthState,
  orderId: string,
  docId: string,
  pageNumber: number,
  ctx: TransitionContext & { orderVersion: number },
): { order: OrderSnapshot; quarantined: DocumentSnapshot; remainder: DocumentSnapshot | null } {
  const split = splitAndQuarantine(state, docId, pageNumber, ctx);
  const order = transitionOrder(state, orderId, "NEEDS_ADMIN_REVIEW", {
    actor: ctx.actor,
    expectedVersion: ctx.orderVersion,
    reason: "WRONG_PATIENT_PAGE",
    detail: ctx.detail ?? { page: pageNumber, name: "another patient", dob: "unknown", sender: "the sender" },
    checkIds: ["MA-3"],
    now: ctx.now,
  });
  return { order, ...split };
}

export function recordSideEffect(state: AuthState, effect: Effect): void {
  db(state).effects.push({ ...effect });
}

const DOCUMENT_CLEARS: readonly ReasonCode[] = [
  "UNREADABLE_DOCUMENT",
  "NO_MATCH",
  "MISSING_DOCUMENTS",
  "SIDE_MISMATCH",
  "WRONG_PATIENT_PAGE",
  "INSURER_MISMATCH",
  "CPT_MISMATCH",
  "MORE_INFO_REQUESTED",
];

function restartForAttachment(state: AuthState, orderId: string, ctx: TransitionContext): void {
  const order = mustOrder(state, orderId);
  if (order.status !== "NEEDS_ADMIN_REVIEW" || !order.reason || !DOCUMENT_CLEARS.includes(order.reason)) return;
  transitionOrder(state, orderId, "PROCESSING", {
    actor: { kind: "system" },
    expectedVersion: order.statusVersion,
    reason: null,
    step: resumeStepFor(order.reason),
    detail: { insurer: order.detail.insurer ?? null, n: order.detail.n ?? null },
    trigger: "document_attached",
    now: ctx.now,
  });
}

function assertOrderActor(order: OrderData, to: OrderStatus, ctx: TransitionContext): void {
  const actor = ctx.actor;
  if (ctx.mutateCriteria && actor.kind === "user" && actor.role === "coordinator") {
    throw new TransitionDeniedError("Coordinators can't edit criterion results");
  }

  if (to === "DENIED" && actor.kind === "system") {
    throw new TransitionDeniedError("The system can't set Denied");
  }

  if (to === "CANCELLED") {
    if (actor.kind === "system") {
      if (!ctx.epicCancelled) throw new TransitionDeniedError("The system may cancel only when Epic reports the order cancelled");
      return;
    }
    if (!actor.permissions.includes("cancel")) throw new TransitionDeniedError("Cancel permission is required");
    return;
  }

  if (actor.kind === "system") {
    if (ctx.trigger === "document_attached" && order.status === "NEEDS_ADMIN_REVIEW" && to === "PROCESSING") return;
    if (order.status === "PROCESSING") return;
    if (order.status === "SUBMITTED" && (to === "APPROVED" || to === "NEEDS_ADMIN_REVIEW" || to === "NEEDS_CLINICAL_REVIEW")) return;
    if (order.status === "APPROVED" && to === "PROCESSING") return;
    if (order.status === "NEEDS_ADMIN_REVIEW" && order.reason === "PORTAL_UPLOAD" && to === "SUBMITTED") return;
    if (order.status === "NEEDS_ADMIN_REVIEW" && order.reason === "WRITEBACK_FAILED" && to === "APPROVED") return;
    if (order.status === "NEEDS_CLINICAL_REVIEW" && order.reason === "PEER_TO_PEER" && to === "APPROVED") return;
    throw new TransitionDeniedError("The system can't leave this status");
  }

  const role = actor.role === "rules_admin" ? "nurse" : actor.role;
  if (role === "coordinator") {
    if (order.status === "NEEDS_CLINICAL_REVIEW" && to === "PROCESSING") {
      throw new TransitionDeniedError("A coordinator can't approve for submission");
    }
    if (order.status === "PROCESSING" && to === "SUBMITTED") {
      throw new TransitionDeniedError("Coordinators can't submit through the API");
    }
    if (order.status === "NEEDS_ADMIN_REVIEW" && (to === "PROCESSING" || to === "SUBMITTED")) return;
    if (order.status === "NEEDS_ADMIN_REVIEW" && order.reason === "WRITEBACK_FAILED" && to === "APPROVED") return;
    if (order.status === "SUBMITTED" && (to === "APPROVED" || to === "NEEDS_ADMIN_REVIEW" || to === "NEEDS_CLINICAL_REVIEW")) return;
    throw new TransitionDeniedError(`A coordinator can't move an order from ${order.status} to ${to}`);
  }

  if (order.status === "NEEDS_ADMIN_REVIEW" && to === "SUBMITTED") {
    throw new TransitionDeniedError("A nurse can't confirm a portal upload");
  }
  if (order.status === "NEEDS_CLINICAL_REVIEW" && (to === "PROCESSING" || to === "SUBMITTED" || to === "DENIED")) return;
  if (order.status === "NEEDS_CLINICAL_REVIEW" && order.reason === "PEER_TO_PEER" && to === "APPROVED") return;
  throw new TransitionDeniedError(`A nurse can't move an order from ${order.status} to ${to}`);
}

function assertOrderConditions(order: OrderData, to: OrderStatus, ctx: TransitionContext): void {
  if (to === "APPROVED") {
    const approval = ctx.approval;
    if (!approval?.number?.trim() || !approval.cpt?.trim() || !approval.validFrom?.trim() || !approval.validTo?.trim()) {
      throw new TransitionDeniedError("Approved requires an approval number, CPT, valid-from and valid-to");
    }
  }

  if (order.status === "APPROVED" && to === "PROCESSING") {
    if (ctx.actor.kind !== "system") throw new TransitionDeniedError("Only the system can reopen an approval");
    if (order.scanCompleted) throw new TransitionDeniedError("The scan is already complete");
    const allowed = ["scan_outside_approval", "cpt_side_or_facility_changed", "insurer_changed"];
    if (!ctx.epicEvent || !allowed.includes(ctx.epicEvent)) throw new TransitionDeniedError("Re-approval needs an Epic change");
  }

  if (order.status === "NEEDS_ADMIN_REVIEW" && to === "APPROVED") {
    if (order.reason !== "WRITEBACK_FAILED") throw new TransitionDeniedError("Only a failed write-back can be confirmed from admin review");
    if (!ctx.writeBackConfirmed && !ctx.epicAuthId?.trim()) throw new TransitionDeniedError("Epic auth id is required");
  }

  if (order.status === "NEEDS_CLINICAL_REVIEW" && to === "APPROVED") {
    if (order.reason !== "PEER_TO_PEER") throw new TransitionDeniedError("Only a peer-to-peer outcome can approve from clinical review");
    if (!ctx.writeBackConfirmed) throw new TransitionDeniedError("Write the approval to Epic before approving");
  }

  if (order.status === "NEEDS_ADMIN_REVIEW" && to === "SUBMITTED") {
    if (!ctx.portalReference?.trim()) throw new TransitionDeniedError("Uploaded needs the portal reference number");
  }

  if (order.status === "NEEDS_CLINICAL_REVIEW" && to === "SUBMITTED" && order.reason !== "DENIED_DECIDE_APPEAL") {
    throw new TransitionDeniedError("An appeal can only be filed from Denied: decide on appeal");
  }

  if (order.status === "NEEDS_CLINICAL_REVIEW" && to === "PROCESSING" && ctx.trigger !== "send_for_documents") {
    if (!ctx.note?.trim()) throw new TransitionDeniedError("A note is required");
  }

  if (to === "CANCELLED") {
    const personReasons: ReasonCode[] = ["WITHDRAWN_BY_NURSE", "WITHDRAWN_BY_COORDINATOR", "SLOT_RELEASED"];
    if (ctx.actor.kind === "system" && ctx.reason !== "EPIC_CANCELLED") {
      throw new TransitionDeniedError("Epic cancellations use the Epic cancelled reason");
    }
    if (ctx.actor.kind === "user" && (ctx.reason == null || !personReasons.includes(ctx.reason))) {
      throw new TransitionDeniedError("A cancel reason is required");
    }
  }
}

function assertDocumentActor(ctx: TransitionContext): void {
  if (ctx.actor.kind === "system") return;
  const role = ctx.actor.role === "rules_admin" ? "nurse" : ctx.actor.role;
  if (role === "coordinator") return;
  throw new TransitionDeniedError(`A ${role} can't change a document status`);
}

function sentenceFor(to: OrderStatus, reason: ReasonCode | null, step: ProcessingStep | null, detail: ReasonDetail): string {
  if (to === "PROCESSING" && detail.whatChanged) return `Re-approval needed: ${detail.whatChanged}`;
  if (to === "PROCESSING" && step) return stepProgress(step, detail);
  if (!reason) return "Status changed";
  const sentence = explainReason(reason, detail);
  return unfilledPlaceholders(sentence).length > 0 ? reasonChip(reason) : sentence;
}

function recordOrderEffects(state: AuthState, order: OrderData, ctx: TransitionContext, sentence: string): void {
  const effects = db(state).effects;
  if (ctx.reason === "MISSING_DOCUMENTS") {
    const follow = ctx.followUp ?? DEFAULT_FOLLOW_UP;
    effects.push({ type: "records_request", orderId: order.id, detail: sentence });
    effects.push({ type: "follow_up_timer", orderId: order.id, rerequestHours: follow.rerequestHours, phoneHours: follow.phoneHours });
  }
  if (ctx.reason === "RULE_GAP" || ctx.reason === "DENIED_DECIDE_APPEAL") {
    effects.push({ type: "rules_admin_task", orderId: order.id, detail: sentence });
  }
  if (order.status === "DENIED") effects.push({ type: "scheduling_notified", orderId: order.id });
  if (order.status === "CANCELLED") effects.push({ type: "release_slot", orderId: order.id });
  if (order.status === "APPROVED" && ctx.approval) effects.push({ type: "write_epic_approval", orderId: order.id, approval: { ...ctx.approval } });
  if (order.status === "NOT_REQUIRED") effects.push({ type: "epic_not_required", orderId: order.id, policyId: ctx.policyId ?? null });
}

function assertReasonActor(order: OrderData, ctx: TransitionContext): void {
  if (ctx.actor.kind === "system") return;
  const role = ctx.actor.role === "rules_admin" ? "nurse" : ctx.actor.role;
  if (role === "coordinator" && (order.status === "NEEDS_ADMIN_REVIEW" || order.status === "SUBMITTED")) return;
  if (role === "nurse" && (order.status === "NEEDS_CLINICAL_REVIEW" || order.status === "SUBMITTED")) return;
  throw new TransitionDeniedError(`A ${role} can't update the reason on ${order.status}`);
}

function checksFor(reason: ReasonCode | null): string[] {
  if (reason === "SIDE_MISMATCH") return ["CO-1"];
  if (reason === "WRONG_PATIENT_PAGE") return ["MA-3"];
  if (reason === "INSURER_MISMATCH") return ["CV-1"];
  if (reason === "CPT_MISMATCH") return ["CO-2"];
  if (reason === "UNREADABLE_DOCUMENT") return ["PP-2"];
  if (reason === "NO_MATCH") return ["MA-1"];
  return [];
}

function writeAudit(state: AuthState, row: Omit<AuditRow, "id">): void {
  db(state).audits.push({ id: nextId(state, "aud"), ...row });
}

function actorId(actor: Actor): string {
  return actor.kind === "system" ? "system" : actor.id;
}

function mustOrder(state: AuthState, id: string): OrderData {
  const order = db(state).orders.get(id);
  if (!order) throw new Error(`Unknown order ${id}`);
  return order;
}

function mustDocument(state: AuthState, id: string): DocumentData {
  const doc = db(state).documents.get(id);
  if (!doc) throw new Error(`Unknown document ${id}`);
  return doc;
}

function copyOrder(order: OrderData): OrderSnapshot {
  return {
    ...order,
    detail: { ...order.detail },
    otherIssues: order.otherIssues.map(copyIssue),
    blockingChecks: [...order.blockingChecks],
    approval: order.approval ? { ...order.approval } : null,
  };
}

function copyDocument(doc: DocumentData): DocumentSnapshot {
  return { ...doc, pageNumbers: [...doc.pageNumbers] };
}

function copyIssue(issue: OtherIssue): OtherIssue {
  return { code: issue.code, detail: { ...issue.detail } };
}

function copyAudit(row: AuditRow): AuditRow {
  return {
    ...row,
    checkIds: [...row.checkIds],
    criterionResults: row.criterionResults ? row.criterionResults.map(copyCriterion) : null,
    evidenceRefs: row.evidenceRefs.map((ref) => ({ ...ref })),
  };
}

function copyCriterion(c: CriterionResult): CriterionResult {
  return { ...c, evidence: c.evidence ? { ...c.evidence } : null };
}

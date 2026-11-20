import {
  AWAITING_LOOP_LIMIT,
  CLOSED_DOCUMENT_STATUSES,
  DEFAULT_FOLLOW_UP,
  correctionDestination,
  isLegalDocumentTransition,
  isLegalOrderTransition,
  ownerRole,
} from "./catalog";
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

/** In-memory stand-in for the status tables. Status columns are written only by the transition functions. */
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
    blockingChecks?: string[];
    fixableGaps?: boolean;
    awaitingDocumentsEntries?: number;
    confirmOnly?: boolean;
    linkedApproval?: boolean;
    approval?: ApprovalInput | null;
    now?: Date;
  } = {},
): OrderSnapshot {
  const data = db(state);
  const now = (input.now ?? new Date()).toISOString();
  const order: OrderData = {
    id: input.id ?? nextId(state, "ord"),
    status: input.status ?? "RECEIVED",
    statusVersion: 1,
    channel: input.channel ?? null,
    blockingChecks: [...(input.blockingChecks ?? [])],
    fixableGaps: input.fixableGaps ?? false,
    awaitingDocumentsEntries: input.awaitingDocumentsEntries ?? 0,
    confirmOnly: input.confirmOnly ?? false,
    linkedApproval: input.linkedApproval ?? false,
    approval: input.approval ? { ...input.approval } : null,
    createdAt: now,
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

/** Time in status comes from the latest audit row, not a stored duration. */
export function timeInStatusMs(state: AuthState, orderId: string, now: Date): number {
  const order = mustOrder(state, orderId);
  const audits = db(state).audits.filter((row) => row.orderId === orderId);
  const at = audits.length > 0 ? audits[audits.length - 1].at : order.createdAt;
  return Math.max(0, now.getTime() - new Date(at).getTime());
}

/**
 * The only way to change an order's status. Illegal moves throw IllegalTransitionError.
 * A stale status version throws StaleVersionError before any other check.
 */
export function transitionOrder(state: AuthState, orderId: string, to: OrderStatus, ctx: TransitionContext): OrderSnapshot {
  const order = mustOrder(state, orderId);
  if (order.statusVersion !== ctx.expectedVersion) {
    throw new StaleVersionError(ctx.expectedVersion, order.statusVersion);
  }
  if (!isLegalOrderTransition(order.status, to)) {
    throw new IllegalTransitionError(order.status, to);
  }
  if (to === "AWAITING_DOCUMENTS" && order.awaitingDocumentsEntries >= AWAITING_LOOP_LIMIT) {
    throw new TransitionDeniedError("Documents have been requested 3 times; the order goes to clinical review");
  }

  assertOrderActor(order, to, ctx);
  assertOrderConditions(order, to, ctx);

  const from = order.status;
  const at = (ctx.now ?? new Date()).toISOString();
  order.status = to;
  order.statusVersion += 1;
  if (to === "CLINICAL_REVIEW") order.confirmOnly = ctx.confirmOnly === true;
  else order.confirmOnly = false;
  if (to === "NEEDS_CORRECTION") order.blockingChecks = [...(ctx.checkIds ?? [])];
  if (to === "AWAITING_DOCUMENTS") order.awaitingDocumentsEntries += 1;
  if (to === "APPROVED" && ctx.approval) {
    order.approval = { ...ctx.approval };
    order.linkedApproval = ctx.approval.linked === true;
  }

  const reason = formatReason(to, ctx);
  writeAudit(state, {
    orderId: order.id,
    documentId: null,
    fromStatus: from,
    toStatus: to,
    actor: actorId(ctx.actor),
    at,
    reason,
    checkIds: [...(ctx.checkIds ?? [])],
    criterionResults: ctx.criterionResults ? ctx.criterionResults.map(copyCriterion) : null,
    evidenceRefs: (ctx.evidenceRefs ?? []).map((ref) => ({ ...ref })),
    ruleVersion: ctx.ruleVersion ?? null,
    routingPolicyVersion: ctx.routingPolicyVersion ?? null,
  });
  recordOrderEffects(state, order, to, ctx, reason);
  return copyOrder(order);
}

/**
 * The only way to change a document's status.
 * Attaching a document restarts an order that is waiting on paperwork.
 */
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
    reason: ctx.reason,
    checkIds: [...(ctx.checkIds ?? [])],
    criterionResults: null,
    evidenceRefs: (ctx.evidenceRefs ?? []).map((ref) => ({ ...ref })),
    ruleVersion: ctx.ruleVersion ?? null,
    routingPolicyVersion: ctx.routingPolicyVersion ?? null,
  });

  if (to === "QUARANTINED") {
    db(state).effects.push({ type: "privacy_report", documentId: doc.id, orderId: doc.orderId });
  }

  if (to === "ATTACHED" && doc.orderId) {
    restartOrderForAttachment(state, doc.orderId, ctx);
  }

  return copyDocument(doc);
}

/**
 * One page that fails MA-3 becomes its own quarantined document.
 * The rest of the fax keeps its status and can still be attached.
 */
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
      reason: ctx.reason || `Page ${pageNumber} is for another patient; quarantined`,
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
    reason: ctx.reason || `Page ${pageNumber} is for another patient; quarantined`,
    checkIds: ctx.checkIds ?? ["MA-3"],
    now: ctx.now,
  });
  return { quarantined, remainder: copyDocument(parent) };
}

/**
 * Wrong-patient page: quarantine that page, and move the order from Matching to Needs correction.
 */
export function quarantineWrongPatientPage(
  state: AuthState,
  orderId: string,
  docId: string,
  pageNumber: number,
  ctx: TransitionContext & { orderVersion: number },
): { order: OrderSnapshot; quarantined: DocumentSnapshot; remainder: DocumentSnapshot | null } {
  const split = splitAndQuarantine(state, docId, pageNumber, ctx);
  const order = transitionOrder(state, orderId, "NEEDS_CORRECTION", {
    actor: ctx.actor,
    expectedVersion: ctx.orderVersion,
    reason: ctx.reason,
    checkIds: ["MA-3"],
    now: ctx.now,
  });
  return { order, ...split };
}

/** Side effects that do not change status: resend, notify, message, open packet. */
export function recordSideEffect(state: AuthState, effect: Effect): void {
  db(state).effects.push({ ...effect });
}

function restartOrderForAttachment(state: AuthState, orderId: string, ctx: TransitionContext): void {
  const order = mustOrder(state, orderId);
  const to = attachmentRestart(order);
  if (!to) return;
  transitionOrder(state, orderId, to, {
    actor: { kind: "system" },
    expectedVersion: order.statusVersion,
    reason: "Document attached",
    checkIds: [],
    trigger: "document_attached",
    now: ctx.now,
    ruleVersion: ctx.ruleVersion,
    routingPolicyVersion: ctx.routingPolicyVersion,
  });
}

function attachmentRestart(order: OrderData): OrderStatus | null {
  if (order.status === "AWAITING_DOCUMENTS" || order.status === "MORE_INFO_REQUESTED") return "COLLECTING_EVIDENCE";
  if (order.status === "NEEDS_CORRECTION") return correctionDestination(order.blockingChecks);
  return null;
}

function assertOrderActor(order: OrderData, to: OrderStatus, ctx: TransitionContext): void {
  const actor = ctx.actor;
  if (ctx.mutateCriteria && actor.kind === "user" && actor.role === "coordinator") {
    throw new TransitionDeniedError("Coordinators can't edit criterion results");
  }
  if (to === "READY_TO_SUBMIT" && actor.kind === "user" && actor.role === "coordinator") {
    throw new TransitionDeniedError("Coordinators can't set Ready to submit");
  }
  if (to === "CLOSED_DENIED" && actor.kind === "system") {
    throw new TransitionDeniedError("The system can't set Closed denied");
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
    if (ctx.trigger === "document_attached") {
      if (to !== attachmentRestart(order)) throw new TransitionDeniedError("A new document can't move the order there");
      return;
    }
    if (ctx.trigger === "resend_received" && order.status === "UNREADABLE" && to === "RECEIVED") return;
    if (ownerRole(order.status, order.channel) === "system") return;
    if (order.status === "SUBMITTED") return;
    throw new TransitionDeniedError("The system can't leave this status");
  }

  const role = actor.role === "rules_admin" ? "nurse" : actor.role;
  if (order.status === "SUBMITTED" && role === "coordinator") return;
  if (order.status === "READY_TO_SUBMIT" && order.channel === "portal" && role === "coordinator" && to === "SUBMITTED") return;
  if (order.status === "READY_TO_SUBMIT" && to === "SUBMITTED" && role !== "coordinator") {
    throw new TransitionDeniedError("A nurse can't confirm a portal upload");
  }
  if (ownerRole(order.status, order.channel) !== role) {
    throw new TransitionDeniedError(`A ${role} can't move an order out of ${order.status}`);
  }
}

function assertOrderConditions(order: OrderData, to: OrderStatus, ctx: TransitionContext): void {
  if (to === "APPROVED") {
    const approval = ctx.approval;
    if (!approval?.number?.trim() || !approval.cpt?.trim() || !approval.validFrom?.trim() || !approval.validTo?.trim()) {
      throw new TransitionDeniedError("Approved requires an approval number, CPT, valid-from and valid-to");
    }
  }

  if ((order.status === "CLINICAL_REVIEW" || order.status === "RULE_GAP") && to === "READY_TO_SUBMIT") {
    if (!ctx.note?.trim()) throw new TransitionDeniedError("A note is required");
  }

  if (order.status === "NEEDS_CORRECTION" && (to === "COVERAGE_CHECK" || to === "COLLECTING_EVIDENCE")) {
    const expected = correctionDestination(order.blockingChecks);
    if (to !== expected) throw new TransitionDeniedError(`This correction returns to ${expected}`);
  }

  if (order.status === "CLINICAL_REVIEW" && to === "AWAITING_DOCUMENTS" && !order.fixableGaps) {
    throw new TransitionDeniedError("Send back for documents is only available when the policy has fixable gaps");
  }

  if (order.status === "READY_TO_SUBMIT" && to === "SUBMITTED") {
    if (order.channel === "portal") {
      if (ctx.actor.kind !== "user" || ctx.actor.role === "nurse") {
        throw new TransitionDeniedError("A portal upload is confirmed by a coordinator");
      }
      if (!ctx.portalReference?.trim()) throw new TransitionDeniedError("Uploaded needs the portal reference number");
    } else if (!ctx.trackingNumber?.trim()) {
      throw new TransitionDeniedError("Submitting needs a tracking number");
    }
  }

  if (to === "CANCELLED" && ctx.actor.kind === "user" && !ctx.reason?.trim()) {
    throw new TransitionDeniedError("A cancel reason is required");
  }
}

function assertDocumentActor(ctx: TransitionContext): void {
  if (ctx.actor.kind === "system") return;
  const role = ctx.actor.role === "rules_admin" ? "nurse" : ctx.actor.role;
  if (role === "coordinator") return;
  throw new TransitionDeniedError(`A ${role} can't change a document status`);
}

function formatReason(to: OrderStatus, ctx: TransitionContext): string {
  if (to === "CANCELLED" && ctx.actor.kind === "user") return `Cancelled by ${ctx.actor.id}: ${ctx.reason}`;
  if (to === "CANCELLED") return `Cancelled by system: ${ctx.reason}`;
  if (to === "APPROVED" && ctx.approval?.linked) return `Linked existing approval ${ctx.approval.number}`;
  if (to === "APPROVED" && ctx.approval) {
    return `Approved ${ctx.approval.number}, valid ${ctx.approval.validFrom} to ${ctx.approval.validTo}`;
  }
  return ctx.reason;
}

function recordOrderEffects(state: AuthState, order: OrderData, to: OrderStatus, ctx: TransitionContext, reason: string): void {
  const effects = db(state).effects;
  if (to === "AWAITING_DOCUMENTS") {
    const follow = ctx.followUp ?? DEFAULT_FOLLOW_UP;
    effects.push({ type: "records_request", orderId: order.id, detail: reason });
    effects.push({ type: "follow_up_timer", orderId: order.id, rerequestHours: follow.rerequestHours, phoneHours: follow.phoneHours });
  }
  if (to === "RULE_GAP") effects.push({ type: "rules_admin_task", orderId: order.id, detail: reason });
  if (to === "DENIED") effects.push({ type: "denial_backlog", orderId: order.id, reason: ctx.denialReason ?? reason });
  if (to === "CLOSED_DENIED") effects.push({ type: "scheduling_notified", orderId: order.id });
  if (to === "CANCELLED") effects.push({ type: "release_slot", orderId: order.id });
  if (to === "APPROVED" && ctx.approval) effects.push({ type: "write_epic_approval", orderId: order.id, approval: { ...ctx.approval } });
  if (to === "NOT_REQUIRED") effects.push({ type: "epic_not_required", orderId: order.id, policyId: ctx.policyId ?? null });
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
    blockingChecks: [...order.blockingChecks],
    approval: order.approval ? { ...order.approval } : null,
  };
}

function copyDocument(doc: DocumentData): DocumentSnapshot {
  return { ...doc, pageNumbers: [...doc.pageNumbers] };
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

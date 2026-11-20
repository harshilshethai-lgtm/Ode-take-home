import type { InsurerConfig } from "./config";
import { configFor, INSURER_CONFIG } from "./config";
import { adapterFor, type ApiTransport } from "./adapters";
import { daysLeft, draftAppeal } from "./appeal";
import { scriptedEpic, type EpicClient } from "./epic";
import { appendInteraction, readInteractions } from "./log";
import { approvalMismatches } from "./match";
import { channelWords, ERROR_LABEL, NORMALIZED_LABEL, normalizeStatus } from "./normalize";
import { redactPhi } from "./phi";
import { approvalExpiring, decisionScanAtRisk, nextStatusCheck, pendNamesDocument, retryAt } from "./schedule";
import {
  InsurerRefusal,
  toApprovalInput,
  type ApprovalOffer,
  type InsurerAdapter,
  type InsurerInteraction,
  type NormalizedStatus,
  type StatusResult,
  type SubmissionPacket,
  type TrackedOrder,
} from "./types";
import {
  applyReason,
  AuthState,
  readEffects,
  readOrder,
  recordSideEffect,
  transitionOrder,
} from "@/domain/priorAuth/store";
import type { Actor, ApprovalInput, EpicReapprovalEvent, OrderSnapshot, ReasonDetail } from "@/domain/priorAuth/types";

const system: Actor = { kind: "system" };
const WRITE_ATTEMPTS = 3;

export interface ExternalLog {
  write(line: string): void;
}

export interface InsurerDeps {
  configs?: Record<string, InsurerConfig>;
  epic?: EpicClient;
  transport?: ApiTransport;
  external?: ExternalLog;
  adapters?: Record<string, InsurerAdapter>;
}

interface Track {
  nextCheckAt: string | null;
  scanNotified: boolean;
  expiryNotified: boolean;
  packetUrl: string | null;
  reference: string | null;
  matched: boolean | null;
}

const tracks = new WeakMap<AuthState, Map<string, Track>>();
const portalFailures = new WeakMap<AuthState, Map<string, number>>();

function trackMap(state: AuthState): Map<string, Track> {
  let found = tracks.get(state);
  if (!found) {
    found = new Map();
    tracks.set(state, found);
  }
  return found;
}

export function readTrack(state: AuthState, orderId: string): Track {
  return trackMap(state).get(orderId) ?? { nextCheckAt: null, scanNotified: false, expiryNotified: false, packetUrl: null, reference: null, matched: null };
}

function saveTrack(state: AuthState, orderId: string, patch: Partial<Track>): Track {
  const next = { ...readTrack(state, orderId), ...patch };
  trackMap(state).set(orderId, next);
  return next;
}

function nurse(id = "nurse"): Actor {
  return { kind: "user", id, role: "nurse", permissions: ["cancel"] };
}

function coordinator(id = "coordinator"): Actor {
  return { kind: "user", id, role: "coordinator", permissions: ["cancel"] };
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function packetOf(order: TrackedOrder): SubmissionPacket {
  return {
    orderId: order.id,
    insurerId: order.insurerName,
    urgent: order.urgent,
    criteria: order.criteria,
    attachments: order.attachments,
    cpt: order.cpt,
    side: order.side,
    units: order.units,
    scanDate: order.scanAt,
    policyId: order.policyId,
  };
}

function adapterOf(order: TrackedOrder, deps: InsurerDeps, config: InsurerConfig): InsurerAdapter {
  return deps.adapters?.[order.insurerName] ?? adapterFor(config, deps.transport);
}

function epicOf(deps: InsurerDeps): EpicClient {
  return deps.epic ?? scriptedEpic(0);
}

function artifacts(error: unknown): { screenshotUrl?: string; scriptVersion?: string } {
  if (!error || typeof error !== "object") return {};
  const row = error as { screenshotUrl?: string; scriptVersion?: string };
  return { screenshotUrl: row.screenshotUrl, scriptVersion: row.scriptVersion };
}

function logInteraction(
  state: AuthState,
  order: TrackedOrder,
  row: Omit<InsurerInteraction, "id">,
  external?: ExternalLog,
): InsurerInteraction {
  if (row.outcome === "error" && row.error && external) {
    external.write(`${row.kind} ${row.error.type} ${redactPhi(row.error.message, order.phi)}`);
  }
  return appendInteraction(state, row);
}

function baseDetail(order: TrackedOrder, config: InsurerConfig, now: string, reference: string | null, normalized: NormalizedStatus | null): ReasonDetail {
  return {
    insurer: order.insurerName,
    channel: channelWords(config.channel),
    date: shortDate(now),
    ref: reference ?? "",
    time: shortTime(now),
    normalized: normalized ? NORMALIZED_LABEL[normalized] : "",
  };
}

async function confirmWrite(epic: EpicClient, orderId: string, offer: ApprovalOffer): Promise<{ ok: true; authId: string } | { ok: false; error: string }> {
  let last = "Epic timed out";
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    try {
      const wrote = await epic.writeAuthorization(orderId, offer);
      const read = await epic.readAuthorization(orderId);
      if (read && read.authId === wrote.authId && read.cpt === offer.cpt) return { ok: true, authId: wrote.authId };
      last = "Epic read-back did not match";
    } catch (error) {
      last = error instanceof Error ? error.message : "Epic timed out";
    }
  }
  return { ok: false, error: last };
}

function toSubmitted(state: AuthState, order: TrackedOrder, config: InsurerConfig, reference: string, now: Date, reason: "AWAITING_DECISION" | "APPEAL" | "PENDED_BY_INSURER", extra: ReasonDetail = {}): OrderSnapshot {
  const current = readOrder(state, order.id);
  const detail = { ...baseDetail(order, config, now.toISOString(), reference, "RECEIVED"), ...extra };
  if (current.status === "SUBMITTED") {
    return applyReason(state, order.id, { actor: system, expectedVersion: current.statusVersion, reason, detail, now });
  }
  return transitionOrder(state, order.id, "SUBMITTED", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason,
    detail,
    portalReference: reference,
    now,
  });
}

function failCheck(state: AuthState, order: TrackedOrder, config: InsurerConfig, now: Date, errorLabel: string, normalized: NormalizedStatus | null): OrderSnapshot {
  const current = readOrder(state, order.id);
  const detail = {
    ...baseDetail(order, config, now.toISOString(), readTrack(state, order.id).reference, normalized),
    error: errorLabel,
    time: shortTime(now.toISOString()),
  };
  if (current.status === "NEEDS_ADMIN_REVIEW") {
    return applyReason(state, order.id, { actor: system, expectedVersion: current.statusVersion, reason: "STATUS_CHECK_FAILED", detail, now });
  }
  return transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason: "STATUS_CHECK_FAILED",
    detail,
    now,
  });
}

function notePortalFailure(state: AuthState, insurer: string, orderId: string): void {
  let counts = portalFailures.get(state);
  if (!counts) {
    counts = new Map();
    portalFailures.set(state, counts);
  }
  const next = (counts.get(insurer) ?? 0) + 1;
  counts.set(insurer, next);
  if (next >= 2 && !readEffects(state).some((effect) => effect.type === "ops_lead_alert" && effect.detail.includes(insurer))) {
    recordSideEffect(state, { type: "ops_lead_alert", orderId, detail: `${insurer} portal script is failing` });
  }
}

async function finishApproval(
  state: AuthState,
  order: TrackedOrder,
  config: InsurerConfig,
  offer: ApprovalOffer,
  now: Date,
  reason: "NEW" | "APPEAL_WON" | "LINKED_EXISTING",
  deps: InsurerDeps,
): Promise<OrderSnapshot> {
  const mismatches = approvalMismatches(order, offer, config);
  if (mismatches.length > 0) return mismatch(state, order, offer, mismatches, now);
  const epic = epicOf(deps);
  const confirmed = await confirmWrite(epic, order.id, offer);
  if (!confirmed.ok) {
    const current = readOrder(state, order.id);
    saveTrack(state, order.id, { matched: true });
    if (current.status !== "SUBMITTED") throw new InsurerRefusal("http", confirmed.error);
    return transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
      actor: system,
      expectedVersion: current.statusVersion,
      reason: "WRITEBACK_FAILED",
      detail: { insurer: order.insurerName, number: offer.number, error: confirmed.error, cpt: offer.cpt, validFrom: offer.validFrom, validTo: offer.validTo },
      now,
    });
  }
  const current = readOrder(state, order.id);
  const approval = toApprovalInput(offer, reason === "LINKED_EXISTING");
  saveTrack(state, order.id, { matched: true, reference: offer.number });
  const moved = transitionOrder(state, order.id, "APPROVED", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason,
    approval,
    writeBackConfirmed: true,
    detail: { number: offer.number, cpt: offer.cpt, validFrom: shortDate(offer.validFrom), validTo: shortDate(offer.validTo), insurer: order.insurerName },
    now,
  });
  recordSideEffect(state, { type: "scheduling_notified", orderId: order.id });
  return moved;
}

function mismatch(state: AuthState, order: TrackedOrder, offer: ApprovalOffer, mismatches: ReturnType<typeof approvalMismatches>, now: Date): OrderSnapshot {
  const current = readOrder(state, order.id);
  const detail = {
    insurer: order.insurerName,
    approved: mismatches.map((item) => item.approved).join(", ") || `CPT ${offer.cpt}`,
    ordered: mismatches.map((item) => item.ordered).join(", ") || `CPT ${order.cpt}`,
  };
  saveTrack(state, order.id, { matched: false });
  if (current.status === "NEEDS_ADMIN_REVIEW") {
    return applyReason(state, order.id, { actor: system, expectedVersion: current.statusVersion, reason: "APPROVAL_MISMATCH", detail, now });
  }
  return transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason: "APPROVAL_MISMATCH",
    detail,
    now,
  });
}

function applyNormalized(
  state: AuthState,
  order: TrackedOrder,
  config: InsurerConfig,
  result: StatusResult,
  now: Date,
  deps: InsurerDeps,
): Promise<OrderSnapshot> {
  const reference = result.reference ?? readTrack(state, order.id).reference;
  const current = readOrder(state, order.id);
  if (result.normalized === "RECEIVED" || result.normalized === "IN_REVIEW") {
    saveTrack(state, order.id, { nextCheckAt: nextStatusCheck(config, now).toISOString(), reference });
    return Promise.resolve(toSubmitted(state, order, config, reference ?? "", now, "AWAITING_DECISION", { normalized: NORMALIZED_LABEL[result.normalized] }));
  }
  if (result.normalized === "PENDED") {
    const since = readInteractions(state, order.id).find((row) => row.normalized === "PENDED")?.finishedAt ?? now.toISOString();
    const aged = now.getTime() - new Date(since).getTime() >= config.pendDays * 24 * 36e5;
    const rawReason = quoteOf(result);
    if (pendNamesDocument(rawReason)) recordSideEffect(state, { type: "records_request", orderId: order.id, detail: rawReason });
    if (aged && current.status === "SUBMITTED") {
      return Promise.resolve(transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
        actor: system,
        expectedVersion: current.statusVersion,
        reason: "MORE_INFO_REQUESTED",
        detail: { insurer: order.insurerName, items: rawReason, date: shortDate(now.toISOString()) },
        now,
      }));
    }
    saveTrack(state, order.id, { nextCheckAt: nextStatusCheck(config, now).toISOString(), reference });
    return Promise.resolve(toSubmitted(state, order, config, reference ?? "", now, "PENDED_BY_INSURER", { rawReason, date: shortDate(now.toISOString()) }));
  }
  if (result.normalized === "MORE_INFO_NEEDED") {
    const items = result.items || quoteOf(result);
    return Promise.resolve(transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
      actor: system,
      expectedVersion: readOrder(state, order.id).statusVersion,
      reason: "MORE_INFO_REQUESTED",
      detail: { insurer: order.insurerName, items, date: shortDate(now.toISOString()) },
      now,
    }));
  }
  if (result.normalized === "PEER_TO_PEER_REQUESTED") {
    return Promise.resolve(transitionOrder(state, order.id, "NEEDS_CLINICAL_REVIEW", {
      actor: system,
      expectedVersion: readOrder(state, order.id).statusVersion,
      reason: "PEER_TO_PEER",
      detail: { insurer: order.insurerName, deadline: result.deadline ? shortDate(result.deadline) : "the deadline", phone: result.phone ?? "the number on the response", doctor: "the ordering doctor" },
      now,
    }));
  }
  if (result.normalized === "PARTIALLY_APPROVED") {
    const offer = result.approval ?? { number: reference ?? "approval", cpt: order.cpt, validFrom: now.toISOString(), validTo: now.toISOString() };
    const found = approvalMismatches(order, offer, config);
    return Promise.resolve(mismatch(state, order, offer, found.length > 0 ? found : [{ type: "cpt", ordered: `CPT ${order.cpt}`, approved: `CPT ${offer.cpt} (partial)` }], now));
  }
  if (result.normalized === "APPROVED" && result.approval) {
    const won = readOrder(state, order.id).reason === "APPEAL" ? "APPEAL_WON" : "NEW";
    return finishApproval(state, order, config, result.approval, now, won, deps);
  }
  if (result.normalized === "DENIED") {
    const reasonText = quoteOf(result);
    const round = current.reason === "APPEAL" ? Number(current.detail.round ?? 1) + 1 : 1;
    const draft = draftAppeal(order, reasonText);
    const deadline = result.deadline ?? "";
    const left = daysLeft(result.deadline, now);
    recordSideEffect(state, { type: "rules_admin_task", orderId: order.id, detail: `${order.policyId ?? "policy"} ${reasonText}` });
    return Promise.resolve(transitionOrder(state, order.id, "NEEDS_CLINICAL_REVIEW", {
      actor: system,
      expectedVersion: readOrder(state, order.id).statusVersion,
      reason: "DENIED_DECIDE_APPEAL",
      policyId: order.policyId,
      detail: {
        insurer: order.insurerName,
        date: shortDate(now.toISOString()),
        denialReason: reasonText,
        reason: reasonText,
        deadline: deadline ? shortDate(deadline) : "the deadline",
        days: left ?? 0,
        draft,
        round,
        policy: order.policyId ?? "",
      },
      now,
    }));
  }
  return Promise.resolve(failCheck(state, order, config, now, "Unknown", result.normalized === "UNKNOWN" ? null : result.normalized));
}

function quoteOf(result: StatusResult): string {
  try {
    const parsed = JSON.parse(result.raw) as { detail?: string; status?: string; items?: string };
    return parsed.detail || parsed.items || parsed.status || result.raw;
  } catch {
    return result.raw;
  }
}

async function handleStatusError(state: AuthState, order: TrackedOrder, config: InsurerConfig, error: InsurerRefusal, attempt: number, now: Date, kind: InsurerInteraction["kind"], external?: ExternalLog): Promise<OrderSnapshot> {
  const shot = artifacts(error);
  logInteraction(state, order, {
    orderId: order.id,
    insurerId: config.insurerId,
    kind,
    channel: config.channel,
    attempt,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    outcome: "error",
    error: { type: error.errorType, message: error.message },
    rawResponse: error.message,
    reference: readTrack(state, order.id).reference ?? undefined,
    actor: "system",
    ...shot,
    ...(config.channel === "portal_automation" && !shot.scriptVersion ? { scriptVersion: "2026.11.1", screenshotUrl: shot.screenshotUrl ?? `portal-shot://${order.id}/error` } : {}),
  }, external);
  const rows = readInteractions(state, order.id);
  const count = rows.filter((row) => row.kind === "status_check" && row.outcome === "error").length;
  const immediate = error.errorType === "page_changed" || error.errorType === "auth_failed";
  if (kind === "status_check" && (immediate || count >= 3)) {
    if (config.channel === "portal_automation") notePortalFailure(state, order.insurerName, order.id);
    const last = [...rows].reverse().find((row) => row.normalized)?.normalized ?? null;
    return failCheck(state, order, config, now, ERROR_LABEL[error.errorType] ?? "Unknown error", last);
  }
  saveTrack(state, order.id, { nextCheckAt: retryAt(config, now, attempt).toISOString() });
  return readOrder(state, order.id);
}

export async function submitToInsurer(state: AuthState, order: TrackedOrder, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  if (config.channel === "manual") {
    const current = readOrder(state, order.id);
    if (current.status === "NEEDS_ADMIN_REVIEW" && current.reason === "PORTAL_UPLOAD") return current;
    return transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
      actor: system,
      expectedVersion: current.statusVersion,
      reason: "PORTAL_UPLOAD",
      detail: { n: order.criteria.length, insurer: order.insurerName, k: order.attachments.length },
      now,
    });
  }
  const adapter = adapterOf(order, deps, config);
  let lastError = "Rejected";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = now.toISOString();
    try {
      const submitted = await adapter.submit(packetOf(order));
      logInteraction(state, order, {
        orderId: order.id,
        insurerId: config.insurerId,
        kind: "submission",
        channel: config.channel,
        attempt,
        startedAt: started,
        finishedAt: new Date().toISOString(),
        outcome: "ok",
        reference: submitted.reference,
        rawResponse: submitted.raw,
        attachmentsSent: order.attachments.map((item) => ({ docId: item.docId, pages: item.pages })),
        screenshotUrl: submitted.screenshotUrl,
        scriptVersion: submitted.scriptVersion,
        actor: "system",
      }, deps.external);
      saveTrack(state, order.id, { reference: submitted.reference, packetUrl: `packet://${order.id}/as-sent` });
      const status = await adapter.checkStatus(submitted.reference);
      logInteraction(state, order, rowFromStatus(order, config, status, 1, started), deps.external);
      return applyNormalized(state, order, config, status, now, deps);
    } catch (error) {
      if (error instanceof InsurerRefusal && /cannot be amended/i.test(error.message)) throw error;
      lastError = error instanceof Error ? error.message : "Rejected";
      const refusal = error instanceof InsurerRefusal ? error : new InsurerRefusal("unknown", lastError);
      const shot = artifacts(error);
      logInteraction(state, order, {
        orderId: order.id,
        insurerId: config.insurerId,
        kind: "submission",
        channel: config.channel,
        attempt,
        startedAt: started,
        finishedAt: started,
        outcome: "error",
        error: { type: refusal.errorType, message: refusal.message },
        rawResponse: refusal.message,
        actor: "system",
        ...shot,
        ...(config.channel === "portal_automation" && !shot.scriptVersion ? { scriptVersion: "2026.11.1", screenshotUrl: shot.screenshotUrl ?? `portal-shot://${order.id}/submit-error` } : {}),
      }, deps.external);
    }
  }
  const current = readOrder(state, order.id);
  return transitionOrder(state, order.id, "NEEDS_ADMIN_REVIEW", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason: "SUBMISSION_FAILED",
    detail: { insurer: order.insurerName, channel: channelWords(config.channel), error: lastError, n: 3 },
    now,
  });
}

function rowFromStatus(order: TrackedOrder, config: InsurerConfig, status: StatusResult, attempt: number, started: string): Omit<InsurerInteraction, "id"> {
  return {
    orderId: order.id,
    insurerId: config.insurerId,
    kind: "status_check",
    channel: config.channel,
    attempt,
    startedAt: started,
    finishedAt: started,
    outcome: "ok",
    reference: status.reference,
    rawResponse: status.raw,
    normalized: status.normalized,
    screenshotUrl: status.screenshotUrl,
    scriptVersion: status.scriptVersion,
    actor: "system",
  };
}

export async function checkNow(state: AuthState, order: TrackedOrder, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  const reference = readTrack(state, order.id).reference;
  if (!reference) throw new InsurerRefusal("unknown", "No insurer reference to check");
  const adapter = adapterOf(order, deps, config);
  const attempt = readInteractions(state, order.id).filter((row) => row.kind === "status_check").length + 1;
  const started = now.toISOString();
  try {
    const status = await adapter.checkStatus(reference);
    logInteraction(state, order, rowFromStatus(order, config, status, attempt, started), deps.external);
    if (status.normalized === "UNKNOWN") {
      if (config.channel === "portal_automation") notePortalFailure(state, order.insurerName, order.id);
      return failCheck(state, order, config, now, "Unknown", null);
    }
    return applyNormalized(state, order, config, status, now, deps);
  } catch (error) {
    const refusal = error instanceof InsurerRefusal ? error : new InsurerRefusal("unknown", error instanceof Error ? error.message : "Unknown error");
    return handleStatusError(state, order, config, refusal, attempt, now, "status_check", deps.external);
  }
}

export async function lookupEligibility(state: AuthState, order: TrackedOrder, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  const result = await adapterOf(order, deps, config).checkEligibility(packetOf(order));
  logInteraction(state, order, {
    orderId: order.id,
    insurerId: config.insurerId,
    kind: "eligibility",
    channel: config.channel,
    attempt: 1,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    outcome: "ok",
    rawResponse: result.raw,
    actor: "system",
    ...(config.channel === "portal_automation" ? { screenshotUrl: `portal-shot://${order.id}/eligibility`, scriptVersion: "2026.11.1" } : {}),
  }, deps.external);
  return readOrder(state, order.id);
}

export async function lookupExisting(state: AuthState, order: TrackedOrder, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  const result = await adapterOf(order, deps, config).findExistingApproval(packetOf(order));
  logInteraction(state, order, {
    orderId: order.id,
    insurerId: config.insurerId,
    kind: "existing_approval",
    channel: config.channel,
    attempt: 1,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    outcome: "ok",
    rawResponse: result.raw,
    reference: result.approval?.number,
    actor: "system",
    ...(config.channel === "portal_automation" ? { screenshotUrl: `portal-shot://${order.id}/approval`, scriptVersion: "2026.11.1" } : {}),
  }, deps.external);
  if (!result.approval) return readOrder(state, order.id);
  return finishApproval(state, order, config, result.approval, now, "LINKED_EXISTING", deps);
}

export async function fileAppeal(state: AuthState, order: TrackedOrder, letter: string, now: Date, deps: InsurerDeps = {}, actor: Actor = nurse()): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  const current = readOrder(state, order.id);
  const round = Number(current.detail.round ?? 1);
  if (round > config.appealLevels) throw new InsurerRefusal("validation", "This insurer does not allow another appeal");
  const reference = readTrack(state, order.id).reference ?? String(current.detail.ref ?? "");
  const submitted = await adapterOf(order, deps, config).submitAppeal({ ...packetOf(order), letter, reference });
  logInteraction(state, order, {
    orderId: order.id,
    insurerId: config.insurerId,
    kind: "appeal_submission",
    channel: config.channel,
    attempt: round,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    outcome: "ok",
    reference: submitted.reference,
    rawResponse: submitted.raw,
    screenshotUrl: submitted.screenshotUrl,
    scriptVersion: submitted.scriptVersion,
    actor: actor.kind === "system" ? "system" : actor.id,
  }, deps.external);
  saveTrack(state, order.id, { reference: submitted.reference, nextCheckAt: nextStatusCheck(config, now).toISOString() });
  return transitionOrder(state, order.id, "SUBMITTED", {
    actor,
    expectedVersion: current.statusVersion,
    reason: "APPEAL",
    detail: { date: shortDate(now.toISOString()), ref: submitted.reference, due: current.detail.deadline ? String(current.detail.deadline) : "the deadline", draft: letter, insurer: order.insurerName },
    now,
  });
}

export function requestPeerToPeer(state: AuthState, order: TrackedOrder, now: Date, actor: Actor = nurse()): OrderSnapshot {
  const current = readOrder(state, order.id);
  return applyReason(state, order.id, {
    actor,
    expectedVersion: current.statusVersion,
    reason: "PEER_TO_PEER",
    detail: { ...current.detail, insurer: order.insurerName, doctor: "the ordering doctor" },
    now,
  });
}

export async function recordPeerOutcome(state: AuthState, order: TrackedOrder, outcome: "approved" | "denied", offer: ApprovalOffer | null, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  if (outcome === "denied") {
    const current = readOrder(state, order.id);
    return applyReason(state, order.id, {
      actor: nurse(),
      expectedVersion: current.statusVersion,
      reason: "DENIED_DECIDE_APPEAL",
      detail: { ...current.detail, insurer: order.insurerName, date: shortDate(now.toISOString()), denialReason: current.detail.denialReason ?? "peer-to-peer denied", reason: current.detail.reason ?? "peer-to-peer denied", deadline: current.detail.deadline ?? "the deadline", days: current.detail.days ?? 0 },
      now,
    });
  }
  if (!offer) throw new InsurerRefusal("validation", "An approved peer-to-peer needs the approval");
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  return finishApproval(state, order, config, offer, now, "NEW", deps);
}

export function closeAsDenied(state: AuthState, orderId: string, now: Date, actor: Actor = nurse()): OrderSnapshot {
  const current = readOrder(state, orderId);
  return transitionOrder(state, orderId, "DENIED", {
    actor,
    expectedVersion: current.statusVersion,
    reason: "NO_APPEAL",
    detail: { date: shortDate(now.toISOString()) },
    now,
  });
}

export function applyEpicChange(state: AuthState, orderId: string, event: EpicReapprovalEvent, whatChanged: string, now: Date, scanAt?: string): OrderSnapshot {
  const current = readOrder(state, orderId);
  if (event === "scan_outside_approval" && current.approval && scanAt) {
    const scan = new Date(scanAt).getTime();
    const from = new Date(current.approval.validFrom).getTime();
    const to = new Date(current.approval.validTo).getTime();
    if (scan >= from && scan <= to) throw new InsurerRefusal("validation", "The new scan date is still inside the approval");
  }
  return transitionOrder(state, orderId, "PROCESSING", {
    actor: system,
    expectedVersion: current.statusVersion,
    reason: null,
    step: "COVERAGE",
    epicEvent: event,
    detail: { whatChanged, insurer: current.detail.insurer ?? "the insurer", n: 4 },
    now,
  });
}

export function watchScanRisk(state: AuthState, orderId: string, scanAt: string | null, now: Date): { atRisk: boolean; notified: boolean } {
  const current = readOrder(state, orderId);
  const atRisk = decisionScanAtRisk(current.status, scanAt ? new Date(scanAt) : null, now);
  if (!atRisk || readTrack(state, orderId).scanNotified) return { atRisk, notified: false };
  recordSideEffect(state, { type: "scheduling_notified", orderId });
  saveTrack(state, orderId, { scanNotified: true });
  return { atRisk: true, notified: true };
}

export function watchApprovalExpiry(state: AuthState, orderId: string, now: Date): boolean {
  const current = readOrder(state, orderId);
  if (current.status !== "APPROVED" || current.scanCompleted || !current.approval) return false;
  if (!approvalExpiring(current.approval.validTo, now, 3) || readTrack(state, orderId).expiryNotified) return false;
  recordSideEffect(state, { type: "scheduling_notified", orderId });
  saveTrack(state, orderId, { expiryNotified: true });
  return true;
}

export async function runDueChecks(state: AuthState, orders: TrackedOrder[], now: Date, deps: InsurerDeps = {}): Promise<void> {
  for (const order of orders) {
    const due = readTrack(state, order.id).nextCheckAt;
    const current = readOrder(state, order.id);
    if (current.status === "SUBMITTED" && due && new Date(due).getTime() <= now.getTime()) await checkNow(state, order, now, deps);
  }
}

export async function retryWrite(state: AuthState, order: TrackedOrder, offer: ApprovalOffer, now: Date, deps: InsurerDeps = {}): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  return finishApproval(state, order, config, offer, now, "NEW", deps);
}

export function markWritten(state: AuthState, orderId: string, epicAuthId: string, approval: ApprovalInput, now: Date, actor: Actor = coordinator()): OrderSnapshot {
  const current = readOrder(state, orderId);
  return transitionOrder(state, orderId, "APPROVED", {
    actor,
    expectedVersion: current.statusVersion,
    reason: "NEW",
    approval,
    epicAuthId,
    writeBackConfirmed: true,
    detail: { number: approval.number, cpt: approval.cpt, validFrom: approval.validFrom, validTo: approval.validTo },
    now,
  });
}

/** A person typed the insurer's answer after a failed check. The order returns to Submitted, then the answer is applied. */
export async function recordStatusManually(state: AuthState, order: TrackedOrder, raw: string, now: Date, deps: InsurerDeps = {}, actor: Actor = coordinator()): Promise<OrderSnapshot> {
  const config = configFor(order.insurerName, deps.configs ?? INSURER_CONFIG);
  const reference = readTrack(state, order.id).reference ?? `manual-${order.id}`;
  const current = readOrder(state, order.id);
  logInteraction(state, order, {
    orderId: order.id,
    insurerId: config.insurerId,
    kind: "status_check",
    channel: "manual",
    attempt: 1,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    outcome: "ok",
    reference,
    rawResponse: raw,
    normalized: normalizeStatus(config.name, raw),
    actor: actor.kind === "system" ? "system" : actor.id,
  }, deps.external);
  if (current.status === "NEEDS_ADMIN_REVIEW") {
    transitionOrder(state, order.id, "SUBMITTED", {
      actor,
      expectedVersion: current.statusVersion,
      reason: "AWAITING_DECISION",
      detail: baseDetail(order, config, now.toISOString(), reference, "RECEIVED"),
      portalReference: reference,
      now,
    });
  }
  const normalized = normalizeStatus(config.name, raw);
  return applyNormalized(state, order, config, { raw: JSON.stringify({ status: raw, detail: raw }), normalized, reference }, now, deps);
}

export const SCAN_RISK_MESSAGE = "hold or move?";

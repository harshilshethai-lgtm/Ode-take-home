// Review panel view model. The case page only renders this; it does not re-decide status.

import { buildSeedDb } from "@/data/rules/seed";
import { SEED_ORDERS, DEMO_NOW } from "@/data/orders";
import { buildCaseRecord } from "@/domain/caseRecord";
import { actionsFor, statusLabel, type StatusAction } from "@/domain/priorAuth/actions";
import { correctionDestination, ownerRole } from "@/domain/priorAuth/catalog";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import type { OrderStatus, UserRole } from "@/domain/priorAuth/types";
import { incompleteHandlingOf } from "@/domain/rules/policyProperties";
import type { PolicyVersion } from "@/domain/rules/types";
import { computeTimeRisk, fixByAt } from "@/domain/timeRisk";
import type { Order } from "@/domain/types";
import type { CheckResult, CheckRow, ReviewPanel } from "./types";

const BEFORE_COVERAGE = new Set<OrderStatus>(["RECEIVED", "PRE_PROCESSING", "UNREADABLE", "MATCHING", "UNMATCHED"]);

const CONSISTENCY: Array<{ id: string; label: string }> = [
  { id: "CO-1", label: "Same side throughout" },
  { id: "CO-2", label: "CPT matches the study" },
  { id: "CO-3", label: "Diagnosis matches the body part" },
  { id: "CO-4", label: "Same patient on every page" },
  { id: "CO-5", label: "Insurer matches the card" },
];

/** Packet lines that are Halcyon checks or coverage, not insurer criteria. */
const NOT_A_CRITERION = new Set(["Same side throughout", "Active payer", "Approval needed", "Existing approval", "Outpatient policy"]);

const RANK: Record<CheckResult, number> = { NOT_MET: 0, UNCLEAR: 1, WAIVED: 2, EXCEPTION_MET: 2, FIXED: 3, MET: 4 };

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });

type Fact = { result: CheckResult; found: string; page?: number; quote?: string };

interface CaseFacts {
  headline: string;
  assumption?: string;
  /** When set, these results replace a zip against the packet. Missing keys stay Unclear. */
  criteria?: Record<string, Fact>;
  waiver?: CheckRow;
  consistency?: Record<string, Fact>;
  hideChecks?: boolean;
  resolve?: { text: string; contact?: string };
  receivedAt?: string;
  evaluatedAt?: string;
  receivedKind?: "fax" | "record";
  notes?: CheckRow[];
  extraDocuments?: ReviewPanel["documents"];
  evidence?: ReviewPanel["evidence"];
}

const fax = (page: number, quote: string) => ({ docId: "packet", page, quote });

const OBRIEN_RECEIVED = "2026-11-11T16:02:00";
const OBRIEN_EVALUATED = "2026-11-11T16:18:00";

const FACTS: Record<string, CaseFacts> = {
  "case-1-kirk": {
    headline: "Meets all 4 criteria; ready to send via API",
    receivedKind: "record",
    criteria: {
      symptom_duration: { result: "MET", found: "8 wks, onset 9/14", page: 1, quote: "x 8 weeks" },
      conservative_care: { result: "MET", found: "PT 12 visits, 9/21 to 10/31", page: 3, quote: "12 attended, 0 missed" },
      prior_xray: { result: "MET", found: "X-ray 10/02", page: 2, quote: "XR LUMBAR SPINE" },
      no_recent_mri: { result: "MET", found: "No lumbar MRI on record", page: 2, quote: "No MRI of the lumbar spine" },
    },
  },
  "case-2-scott": {
    headline: "Waiting on PT notes (page 4) from Utopia Planitia Rehab",
    receivedKind: "fax",
    resolve: { text: "Request resend of the PT notes (page 4) from Utopia Planitia Rehab", contact: "Utopia Planitia Rehab" },
    criteria: {
      symptom_duration: { result: "MET", found: "7 wks, onset ~9/22", page: 3, quote: "x 7 wks" },
      conservative_care: { result: "UNCLEAR", found: "Only the patient's report", page: 3, quote: "about six weeks" },
      prior_xray: { result: "MET", found: "X-ray 09/24", page: 4, quote: "XR KNEE RIGHT" },
      no_recent_mri: { result: "UNCLEAR", found: "Not in the fax", page: 1, quote: "PT progress notes" },
    },
    notes: [
      {
        id: "PP-4",
        result: "NOT_MET",
        label: "Listed document not found",
        found: "PT notes on the cover are not in the fax",
        ...fax(1, "PT progress notes"),
      },
    ],
    evidence: [
      {
        fact: "documented treatment",
        forCheckId: "conservative_care",
        rows: [
          { source: "Office note", value: "Patient reports 6 weeks", conflict: false, quote: "about six weeks", docId: "packet", page: 3 },
          { source: "Cover", value: "PT notes missing", conflict: false, quote: "PT progress notes", docId: "packet", page: 1 },
        ],
      },
      {
        fact: "prior MRI",
        forCheckId: "no_recent_mri",
        rows: [{ source: "Fax", value: "Not stated", conflict: false, quote: "PT progress notes", docId: "packet", page: 1 }],
      },
    ],
  },
  "case-3-sulu": {
    headline: "Doesn't meet IMG-330: 3 weeks of symptoms, needs 6",
    receivedKind: "record",
    resolve: { text: "Review the symptom gap: 3 weeks recorded, the policy needs 6", contact: "Leonard McCoy, MD" },
    criteria: {
      symptom_duration: { result: "NOT_MET", found: "3 weeks, needs 6", page: 1, quote: "x 3 wks" },
      conservative_care: { result: "NOT_MET", found: "1 week of PT, needs 6", page: 1, quote: "Started PT last wk" },
      prior_xray: { result: "NOT_MET", found: "No shoulder X-ray in the order", page: 1, quote: "MRI SHOULDER RIGHT" },
      no_recent_mri: { result: "UNCLEAR", found: "Not checked: imaging history isn't in the order", page: 1, quote: "MRI SHOULDER RIGHT" },
    },
    evidence: [
      {
        fact: "symptom duration",
        forCheckId: "symptom_duration",
        rows: [{ source: "Order", value: "3 weeks", conflict: false, quote: "x 3 wks", docId: "packet", page: 1 }],
      },
      {
        fact: "documented treatment",
        forCheckId: "conservative_care",
        rows: [{ source: "Order", value: "PT started last week", conflict: false, quote: "Started PT last wk", docId: "packet", page: 1 }],
      },
      {
        fact: "shoulder X-ray",
        forCheckId: "prior_xray",
        rows: [{ source: "Order", value: "Not mentioned", conflict: false, quote: "MRI SHOULDER RIGHT", docId: "packet", page: 1 }],
      },
    ],
  },
  "case-4-janeway": {
    headline: "Meets all 4 criteria; ready to send via API",
    receivedKind: "record",
    criteria: {
      symptom_duration: { result: "WAIVED", found: "Waiver: cauda equina symptoms", page: 1, quote: "x 10 days" },
      conservative_care: { result: "WAIVED", found: "Waiver: cauda equina symptoms", page: 1, quote: "Has not started PT" },
      prior_xray: { result: "WAIVED", found: "Waiver: cauda equina symptoms", page: 1, quote: "No X-ray obtained" },
      no_recent_mri: { result: "MET", found: "No imaging on record", page: 1, quote: "No imaging on record" },
    },
    waiver: {
      id: "waiver:cauda",
      result: "WAIVED",
      label: "Waiver: cauda equina symptoms",
      found: "Urinary retention and saddle numbness",
      ...fax(1, "cauda equina"),
    },
  },
  "case-15-nog": {
    headline: "Page 3 belongs to another patient; removed from the packet",
    receivedKind: "fax",
    resolve: { text: "Request Nog's PT records", contact: "Bashir-Mora, MD" },
    consistency: {
      "CO-4": { result: "NOT_MET", found: "Page 3 is Rom, born 01/11/1975", page: 3, quote: "ROM" },
    },
    criteria: {
      symptom_duration: { result: "MET", found: "8 wks on his visit", page: 2, quote: "x 8 wks" },
      conservative_care: { result: "UNCLEAR", found: "Attached note is not his", page: 3, quote: "ROM" },
      prior_xray: { result: "MET", found: "X-ray 10/08", page: 4, quote: "XR LUMBAR SPINE" },
      no_recent_mri: { result: "UNCLEAR", found: "Not on his pages", page: 2, quote: "x 8 wks" },
    },
    notes: [
      {
        id: "MA-3",
        result: "NOT_MET",
        label: "Page quarantined for another patient",
        found: "Removed from packet",
        docId: "quarantine",
        page: 3,
        quote: "ROM",
      },
    ],
    extraDocuments: [{ id: "quarantine", type: "PT note", status: "QUARANTINED", pages: 1 }],
    evidence: [
      {
        fact: "patient on every page",
        forCheckId: "CO-4",
        rows: [
          { source: "Request", value: "Nog", conflict: true, quote: "NOG", docId: "packet", page: 2 },
          { source: "PT note", value: "Rom", conflict: true, quote: "ROM", docId: "packet", page: 3 },
        ],
      },
    ],
  },
  "case-17-obrien": {
    headline: "Request says left knee; every record says right",
    assumption: "right knee",
    receivedKind: "fax",
    receivedAt: OBRIEN_RECEIVED,
    evaluatedAt: OBRIEN_EVALUATED,
    resolve: { text: "Correct the order to the right knee (M25.561)", contact: "J. Bashir-Mora" },
    consistency: {
      "CO-1": { result: "NOT_MET", found: "Request says left; records say right", page: 2, quote: "MRI L knee" },
    },
    criteria: {
      symptom_duration: { result: "MET", found: "8 wks, right knee", page: 3, quote: "RIGHT knee" },
      conservative_care: { result: "MET", found: "Treating note, right knee", page: 3, quote: "RIGHT knee" },
      prior_xray: { result: "MET", found: "Right knee X-ray 09/25", page: 5, quote: "XR KNEE RIGHT" },
      no_recent_mri: { result: "MET", found: "No right-knee MRI on record", page: 3, quote: "RIGHT knee" },
    },
    notes: [
      {
        id: "PP-1",
        result: "FIXED",
        label: "Page rotated",
        found: "Page 3 arrived sideways and was straightened",
        ...fax(3, "RIGHT knee"),
      },
    ],
    evidence: [
      {
        fact: "side",
        forCheckId: "CO-1",
        rows: [
          { source: "Request", value: "Left knee", conflict: true, quote: "MRI L knee", docId: "packet", page: 2 },
          { source: "Office note", value: "Right knee", conflict: true, quote: "RIGHT knee", docId: "packet", page: 3 },
          { source: "X-ray", value: "Right knee", conflict: true, quote: "XR KNEE RIGHT", docId: "packet", page: 5 },
        ],
      },
    ],
  },
  "case-11-troi": {
    headline: "No approval needed: outpatient CT not on Bajoran's list",
    hideChecks: true,
    receivedKind: "record",
  },
  "case-20-odo": {
    headline: "Couldn't read this fax: all 4 pages blank",
    hideChecks: true,
    receivedKind: "fax",
    resolve: { text: "Request a readable copy of this fax", contact: "Promenade Urgent Care · 555-0148" },
    notes: [
      {
        id: "PP-2",
        result: "NOT_MET",
        label: "Blank page",
        found: "All 4 pages blank",
        ...fax(1, "PROMENADE URGENT CARE"),
      },
    ],
  },
};

let seeded: ReturnType<typeof buildSeedDb> | null = null;
function seedDb() {
  seeded ??= buildSeedDb();
  return seeded;
}

export function isPastCoverage(status: OrderStatus, blockingChecks: readonly string[]): boolean {
  if (BEFORE_COVERAGE.has(status)) return false;
  if (status === "NEEDS_CORRECTION" && blockingChecks.length > 0 && blockingChecks.every((id) => id.startsWith("MA-"))) return false;
  return true;
}

/** evaluatedAt is the latest transition into Evaluating, so it cannot precede an attached document. */
export function assertEvaluationAfterReceipt(evaluatedAt: string | undefined, receivedAt: readonly string[]): void {
  if (!evaluatedAt || receivedAt.length === 0) return;
  const latest = Math.max(...receivedAt.map((t) => new Date(t).getTime()));
  if (new Date(evaluatedAt).getTime() < latest) {
    throw new Error(`evaluatedAt ${evaluatedAt} is earlier than an attached document`);
  }
}

export function checksSummary(summary: ReviewPanel["checks"]["summary"]): string {
  const parts: string[] = [];
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.unclear) parts.push(`${summary.unclear} unclear`);
  if (summary.waived) parts.push(`${summary.waived} waived`);
  if (summary.passed) parts.push(`${summary.passed} passed`);
  return parts.join(" · ");
}

export function checksCardVisible(panel: ReviewPanel): boolean {
  return panel.checks.consistency.length + panel.checks.criteria.rows.length > 0;
}

function activeVersion(policyId: string): PolicyVersion | null {
  const db = seedDb();
  const policy = db.policies.find((p) => p.externalPolicyId === policyId);
  if (!policy) return null;
  return db.versions.find((v) => v.policyId === policy.id && v.effectiveTo === null) ?? null;
}

function policyIdOf(ref: string | null): string {
  if (!ref) return "";
  return ref.split(" ")[0] ?? "";
}

function revOf(ref: string | null, version: PolicyVersion | null): number {
  const fromRef = /(?:rev|v)\s*\.?\s*(\d+)/i.exec(ref ?? "");
  if (fromRef) return Number(fromRef[1]);
  return version?.versionNumber ?? 1;
}

function fixByLabel(scanAt: Date): string {
  return `Fix by ${weekday.format(scanAt)} ${scanAt.getMonth() + 1}/${scanAt.getDate()}`;
}

function viewerOwns(role: UserRole, status: OrderStatus, channel: Order["channel"]): boolean {
  return ownerRole(status, channel) === role;
}

function ownerName(status: OrderStatus, channel: Order["channel"]): string {
  const role = ownerRole(status, channel);
  if (role === "nurse") return "nurse";
  if (role === "coordinator") return "coordinator";
  return "system";
}

function personFacing(status: OrderStatus, channel: Order["channel"]): boolean {
  const role = ownerRole(status, channel);
  return role === "coordinator" || role === "nurse";
}

function sentenceFor(action: StatusAction, primary: string | undefined, index: number): string {
  if (index === 0 && primary) return primary;
  switch (action.id) {
    case "cancel_order":
      return "Cancel the order if it should not go ahead";
    case "approve_for_submission":
      return "Approve the packet for submission";
    case "message_ordering_doctor":
      return "Message the ordering doctor about this gap";
    case "send_back_for_documents":
      return "Send the order back until the missing records arrive";
    case "resend_request":
      return "Request the missing records again";
    case "request_resend":
      return "Request a readable copy from the sender";
    case "notify_ordering_doctor":
      return "Notify the ordering doctor about the conflict";
    case "correction_made":
      return "Record that the correction was made";
    case "documents_received":
      return "Mark the requested documents received";
    case "escalate_to_nurse":
      return "Escalate the chase to a nurse";
    case "copy_received":
      return "File the resent copy and start again";
    case "open_packet":
      return "Open the packet and submit it on the portal";
    case "uploaded":
      return "Record the portal reference once it's uploaded";
    default:
      return action.label;
  }
}

function toAction(action: StatusAction, order: Order): NonNullable<ReviewPanel["toResolve"][number]["action"]> {
  if (action.id === "correction_made") {
    return { label: action.label, transition: correctionDestination(order.blockingChecks ?? []) };
  }
  if (action.to) return { label: action.label, transition: action.to };
  return { label: action.label, sideEffect: action.id };
}

function sortRows(rows: CheckRow[]): CheckRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => RANK[a.row.result] - RANK[b.row.result] || a.index - b.index)
    .map((item) => item.row);
}

function isAnnotation(id: string): boolean {
  return id.startsWith("waiver:") || id.startsWith("exception:");
}

function rowFrom(id: string, label: string, fact: Fact): CheckRow {
  return {
    id,
    result: fact.result,
    label,
    found: fact.found,
    ...(fact.page ? { docId: "packet", page: fact.page, quote: fact.quote } : {}),
  };
}

const KEY_BY_PACKET_ID: Record<string, string> = {
  "1": "symptom_duration",
  "2": "conservative_care",
  "3": "prior_xray",
  "4": "no_recent_mri",
  "2a": "symptom_duration",
  "2b": "conservative_care",
  "2c": "prior_xray",
  "2d": "no_recent_mri",
};

function packetFacts(order: Order): Record<string, Fact> {
  const record = buildCaseRecord(order);
  const rows = record.criteria.filter((c) => !NOT_A_CRITERION.has(c.line));
  const version = activeVersion(policyIdOf(order.policyRef));
  const out: Record<string, Fact> = {};
  if (!version) return out;
  const byKey = new Map<string, (typeof rows)[number]>();
  rows.forEach((row, index) => {
    byKey.set(KEY_BY_PACKET_ID[row.id] ?? version.criteria[index]?.key ?? row.id, row);
  });
  for (const criterion of version.criteria) {
    const source = byKey.get(criterion.key);
    if (!source) {
      out[criterion.key] = { result: "UNCLEAR", found: "Not checked: this version has no result" };
      continue;
    }
    const result: CheckResult = source.status === "met" ? "MET" : source.status === "not_met" ? "NOT_MET" : source.status === "waived" ? "WAIVED" : "UNCLEAR";
    const cite = source.cites[0];
    out[criterion.key] = {
      result,
      found: source.fact,
      ...(cite ? { page: cite.page, quote: cite.quote.split(/\s+/).slice(0, 11).join(" ") } : {}),
    };
  }
  return out;
}

function consistencyRows(order: Order, facts: CaseFacts | undefined): CheckRow[] {
  if (facts?.hideChecks) return [];
  const status = toOrderStatus(order.status);
  if (status === "NOT_REQUIRED" || status === "UNREADABLE" || status === "UNMATCHED" || status === "RULE_GAP") return [];
  if (status === "APPROVED" && order.linkedApproval) return [];
  const blocking = new Set(order.blockingChecks ?? []);
  return CONSISTENCY.map((check) => {
    const custom = facts?.consistency?.[check.id];
    if (custom) return rowFrom(check.id, check.label, custom);
    const failed = blocking.has(check.id) || (check.id === "CO-5" && blocking.has("CV-1"));
    if (failed) return rowFrom(check.id, check.label, { result: "NOT_MET", found: order.reason });
    return rowFrom(check.id, check.label, { result: "MET", found: "Agrees" });
  });
}

function criteriaRows(order: Order, facts: CaseFacts | undefined, version: PolicyVersion | null): CheckRow[] {
  if (facts?.hideChecks || !version) return [];
  const status = toOrderStatus(order.status);
  if (status === "NOT_REQUIRED" || status === "UNREADABLE" || status === "UNMATCHED" || status === "RULE_GAP") return [];
  if (status === "APPROVED" && order.linkedApproval) return [];
  const overlay = facts?.criteria ?? packetFacts(order);
  const rows = version.criteria.map((criterion) => {
    const fact = overlay[criterion.key] ?? { result: "UNCLEAR" as const, found: "Not checked: no result was recorded" };
    return rowFrom(criterion.key, criterion.displayLabel, fact);
  });
  if (facts?.waiver) rows.push(facts.waiver);
  return sortRows(rows);
}

function summarize(consistency: CheckRow[], criteria: CheckRow[]): ReviewPanel["checks"]["summary"] {
  const counted = criteria.filter((row) => !isAnnotation(row.id));
  const failed = [...consistency, ...counted].filter((row) => row.result === "NOT_MET").length;
  const unclear = [...consistency, ...counted].filter((row) => row.result === "UNCLEAR").length;
  return {
    failed,
    unclear,
    waived: counted.filter((row) => row.result === "WAIVED").length,
    passed: counted.filter((row) => row.result === "MET").length,
  };
}

function fixtureStillApplies(order: Order): boolean {
  const seed = SEED_ORDERS.find((item) => item.id === order.id);
  return !seed || seed.status === order.status;
}

function headlineFor(order: Order, facts: CaseFacts | undefined, passing: number, total: number, firstFail: string | undefined): string {
  if (facts?.headline && fixtureStillApplies(order)) return facts.headline;
  const status = toOrderStatus(order.status);
  const via = order.channel === "portal" ? "portal" : "API";
  const policy = policyIdOf(order.policyRef);
  switch (status) {
    case "READY_TO_SUBMIT":
      if (total > 0 && passing === total) return `Meets all ${total} criteria; ready to send via ${via}`;
      return `Approved for submission; ready to send via ${via}`;
    case "SUBMITTED":
      return `With ${order.insurer ?? "the insurer"} since ${order.statusSince.slice(0, 10)}`;
    case "AWAITING_DOCUMENTS":
      return order.reason.endsWith(".") ? order.reason.slice(0, -1) : order.reason;
    case "NEEDS_CORRECTION":
      if ((order.blockingChecks ?? []).includes("CO-1")) return "Request says one side; the records say the other";
      if ((order.blockingChecks ?? []).includes("MA-3")) return "A page belongs to another patient; removed from the packet";
      if ((order.blockingChecks ?? []).includes("CV-1") || (order.blockingChecks ?? []).includes("CO-5")) {
        return "Insurer on the order doesn't match the patient's current card";
      }
      return order.reason;
    case "CLINICAL_REVIEW":
      if (order.confirmOnly) return `Confirm before sending: ${order.reason}`;
      return firstFail && policy ? `Doesn't meet ${policy}: ${firstFail}` : order.reason;
    case "RULE_GAP":
      return `${order.insurer ?? "The insurer"} requires approval, but there are no rules for ${order.study}`;
    case "NOT_REQUIRED":
      return `No approval needed: ${order.reason.replace(/\.$/, "")}`;
    case "APPROVED":
      return order.linkedApproval ? `${order.reason}, linked from an earlier order` : order.reason;
    case "DENIED":
      return `Denied: ${order.reason}`;
    case "UNREADABLE":
      return `Couldn't read this fax: ${order.reason.replace(/\.$/, "")}`;
    case "UNMATCHED":
      return "Couldn't match to a patient or order";
    default:
      return order.reason;
  }
}

function coverageRows(order: Order): CheckRow[] {
  const status = toOrderStatus(order.status);
  const blocking = order.blockingChecks ?? [];
  if (!isPastCoverage(status, blocking)) return [];
  const eligibilityFailed = blocking.includes("CV-1") || blocking.includes("CO-5");
  const rows: CheckRow[] = [
    eligibilityFailed
      ? { id: "CV-1", result: "NOT_MET", label: "Eligibility", found: order.reason }
      : { id: "CV-1", result: "MET", label: "Eligibility", found: order.insurer ? `${order.insurer} active on the order` : "Eligibility matches" },
  ];
  if (order.linkedApproval) {
    rows.push({ id: "CV-2", result: "MET", label: "Approval on file", found: "Linked from an earlier order" });
  } else {
    rows.push({ id: "CV-2", result: "MET", label: "Approval on file", found: "No approval on file" });
  }
  return rows;
}

export function ensureCoverage(status: OrderStatus, blockingChecks: readonly string[], rows: CheckRow[], orderId: string): CheckRow[] {
  if (!isPastCoverage(status, blockingChecks)) return rows;
  if (rows.length > 0) return rows;
  console.error(`Coverage checks did not run for ${orderId}`);
  return [{ id: "CV-1", result: "NOT_MET", label: "Eligibility", found: "Not run: pipeline error" }];
}

function documentNotes(facts: CaseFacts | undefined): CheckRow[] {
  return facts?.notes ?? [];
}

function documentsFor(order: Order, facts: CaseFacts | undefined): ReviewPanel["documents"] {
  const record = buildCaseRecord(order);
  const title = record.documents[0]?.title ?? "Packet";
  const status = toOrderStatus(order.status) === "UNREADABLE" ? "UNREADABLE" : "ATTACHED";
  const pages = Math.max(order.attachmentCount, 1);
  return [{ id: "packet", type: title, status, pages }, ...(facts?.extraDocuments ?? [])];
}

function evidenceFor(facts: CaseFacts | undefined, consistency: CheckRow[], criteria: CheckRow[]): ReviewPanel["evidence"] {
  if (facts?.evidence) return facts.evidence;
  const open = [...consistency, ...criteria].filter((row) => row.result === "NOT_MET" || row.result === "UNCLEAR");
  return open
    .filter((row) => row.page && row.quote)
    .map((row) => ({
      fact: row.label,
      forCheckId: row.id,
      rows: [
        {
          source: "Record",
          value: row.found,
          conflict: row.id.startsWith("CO-"),
          quote: row.quote ?? "",
          docId: row.docId ?? "packet",
          page: row.page ?? 1,
        },
      ],
    }));
}

function activityFor(order: Order, evaluatedAt: string | undefined, receivedAt: string | undefined): ReviewPanel["activity"] {
  const status = toOrderStatus(order.status);
  const rows: ReviewPanel["activity"] = [];
  if (evaluatedAt && status !== "EVALUATING") {
    rows.push({
      at: evaluatedAt,
      actor: "System",
      from: statusLabel("EVALUATING"),
      to: statusLabel(status),
      reason: order.reason,
    });
  }
  if (receivedAt) {
    rows.push({
      at: receivedAt,
      actor: "System",
      from: statusLabel("RECEIVED"),
      to: statusLabel("PRE_PROCESSING"),
      reason: "Packet received",
    });
  }
  if (rows.length === 0) {
    rows.push({
      at: order.statusSince,
      actor: "System",
      from: statusLabel("RECEIVED"),
      to: statusLabel(status),
      reason: order.reason,
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function nextStep(order: Order, status: OrderStatus): string {
  const owner = ownerRole(status, order.channel);
  const fallback = order.reason.endsWith(".") ? order.reason.slice(0, -1) : order.reason;
  if (owner !== "coordinator" && owner !== "nurse") return fallback;
  const actions = actionsFor(
    {
      id: order.id,
      status,
      statusVersion: 1,
      channel: order.channel,
      blockingChecks: order.blockingChecks ?? [],
      fixableGaps: false,
      awaitingDocumentsEntries: 0,
      confirmOnly: order.confirmOnly === true,
      linkedApproval: order.linkedApproval === true,
      approval: null,
      createdAt: order.statusSince,
    },
    owner,
  );
  return actions[0] ? sentenceFor(actions[0], undefined, 0) : fallback;
}

function resolveItems(order: Order, role: UserRole, facts: CaseFacts | undefined): ReviewPanel["toResolve"] {
  const status = toOrderStatus(order.status);
  if (!personFacing(status, order.channel)) return [];
  const owner = ownerName(status, order.channel);
  const fresh = fixtureStillApplies(order);
  const contact = fresh ? facts?.resolve?.contact : undefined;
  const text = fresh ? (facts?.resolve?.text ?? (order.reason.endsWith(".") ? order.reason.slice(0, -1) : order.reason)) : undefined;
  if (!viewerOwns(role, status, order.channel)) {
    return [{ text: text ?? nextStep(order, status), owner, contact, readOnly: true }];
  }
  const snapshot = {
    id: order.id,
    status,
    statusVersion: 1,
    channel: order.channel,
    blockingChecks: order.blockingChecks ?? [],
    fixableGaps: status === "CLINICAL_REVIEW" && (facts?.criteria ? Object.values(facts.criteria).some((f) => f.result === "UNCLEAR") : false),
    awaitingDocumentsEntries: 0,
    confirmOnly: order.confirmOnly === true,
    linkedApproval: order.linkedApproval === true,
    approval: null,
    createdAt: order.statusSince,
  };
  const actions = actionsFor(snapshot, role);
  if (actions.length === 0) return [{ text: text ?? nextStep(order, status), owner, contact, readOnly: false }];
  return actions.map((action, index) => ({
    text: sentenceFor(action, text, index),
    owner,
    contact: index === 0 ? contact : undefined,
    action: toAction(action, order),
    readOnly: false,
  }));
}

export function getReviewPanel(orderId: string, viewerRole: UserRole, source?: Order): ReviewPanel {
  const order = source ?? SEED_ORDERS.find((item) => item.id === orderId);
  if (!order) throw new Error(`Unknown order ${orderId}`);
  const status = toOrderStatus(order.status);
  const facts = FACTS[order.id];
  const policyId = policyIdOf(order.policyRef);
  const version = policyId ? activeVersion(policyId) : null;
  const rev = revOf(order.policyRef, version);
  const consistency = sortRows(consistencyRows(order, facts));
  const criteria = criteriaRows(order, facts, version);
  const summary = summarize(consistency, criteria);
  const counted = criteria.filter((row) => !isAnnotation(row.id));
  const firstFail = counted.find((row) => row.result === "NOT_MET");
  const passing = counted.filter((row) => row.result === "MET" || row.result === "WAIVED" || row.result === "EXCEPTION_MET").length;
  const receivedAt = facts?.receivedAt ?? "2026-11-09T15:00:00";
  const evaluated = facts?.hideChecks ? undefined : (facts?.evaluatedAt ?? "2026-11-09T15:40:00");
  const attachedReceived = documentsFor(order, facts)
    .filter((doc) => doc.status === "ATTACHED")
    .map(() => receivedAt);
  assertEvaluationAfterReceipt(evaluated, attachedReceived);

  const scanAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const risk = computeTimeRisk({ scanAt, insurer: order.insurer, status: order.status, now: DEMO_NOW });
  const deadline = scanAt && risk !== "none" ? fixByAt(scanAt, order.insurer) : null;
  const constraint = version && incompleteHandlingOf(version) === "deny_resubmit_new" ? "Denied requests can't be amended" : undefined;

  const coverage = ensureCoverage(status, order.blockingChecks ?? [], coverageRows(order), order.id);

  return {
    status,
    confirmOnly: order.confirmOnly === true,
    linked: order.linkedApproval === true,
    urgent: order.priority === "Urgent",
    orderChannel: order.channel,
    headline: headlineFor(order, facts, passing, counted.length, firstFail?.found),
    context: {
      policyId,
      policyRev: rev,
      channel: order.channel === "portal" ? "portal" : "api",
      ...(constraint ? { constraint } : {}),
    },
    channelKnown: order.channel !== null,
    scan: {
      ...(scanAt ? { at: order.scheduledAt ?? undefined, deadline: deadline ? fixByLabel(deadline) : undefined } : {}),
      risk: risk === "none" ? "on_track" : risk,
    },
    toResolve: resolveItems(order, viewerRole, facts),
    checks: {
      consistency,
      criteria: {
        policyId,
        rev,
        ...(facts?.assumption ? { assumption: facts.assumption } : {}),
        rows: criteria,
      },
      evaluatedAt: evaluated ?? "",
      ...(evaluated ? { receivedAt } : {}),
      receivedKind: facts?.receivedKind ?? (buildCaseRecord(order).documents[0]?.title === "Fax" ? "fax" : "record"),
      summary,
    },
    evidence: facts?.hideChecks ? [] : evidenceFor(facts, consistency, criteria),
    coverage,
    documentNotes: documentNotes(facts),
    documents: documentsFor(order, facts),
    activity: activityFor(order, evaluated, receivedAt),
  };
}

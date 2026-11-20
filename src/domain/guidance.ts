// Reason and next-step copy. The worklist and the case page both read this.

import { caseReceivedAt } from "@/domain/documents";
import { composeAiSummary } from "@/domain/checklistView";
import { explainReason, stepProgress, whatToDo } from "@/domain/priorAuth/reasons";
import { isClosed } from "@/domain/statuses";
import { computeTimeRisk, isSubmitAtRisk, submitByAt } from "@/domain/timeRisk";
import type { Order } from "@/domain/types";
import { DEMO_NOW, parseDemoInstant } from "@/lib/demoClock";

export const SLOT_UNREACHABLE_STEP = "Reschedule scan or request expedited review";

const STEP_LIMIT = 60;

export interface Guidance {
  reason: string;
  nextStep: string;
  /** Submit-by is earlier than the moment the case arrived. */
  unreachable: boolean;
}

export function isSlotUnreachable(order: Order): boolean {
  if (isClosed(order.status) || !order.scheduledAt) return false;
  const received = receivedAt(order);
  if (!received) return false;
  const submitBy = submitByAt(parseDemoInstant(order.scheduledAt), order.insurer);
  return submitBy.getTime() < received.getTime();
}

function receivedAt(order: Order): Date | null {
  const value = caseReceivedAt(order);
  return value ? parseDemoInstant(value) : null;
}

/** The only reason sentence and the only next-step sentence for an order. */
export function guidanceFor(order: Order, now: Date = DEMO_NOW): Guidance {
  const unreachable = isSlotUnreachable(order);
  const reason = order.reasonText?.trim() || (order.reasonCode ? explainReason(order.reasonCode, order.detail) : order.reason);
  const nextStep = clipStep(unreachable ? SLOT_UNREACHABLE_STEP : stepLine(order, now));
  return { reason, nextStep, unreachable };
}

/** Case-page summary. Uses the same next step as the worklist when the slot cannot be met. */
export function caseSummaryText(order: Order, now: Date = DEMO_NOW): string {
  const guide = guidanceFor(order, now);
  const headline = order.reasonText ?? guide.reason;
  if (guide.unreachable) return composeAiSummary(headline, guide.nextStep);
  const next = order.reasonCode ? whatToDo(order.reasonCode, order.detail) : "No person needs to act. The pipeline is still working.";
  const text = composeAiSummary(headline, next);
  if (order.reasonCode !== "MISSING_DOCUMENTS") return text;
  const verdict = text.split(/(?<=\.)\s/)[0] ?? text;
  if (/request a resend/i.test(verdict)) return verdict;
  const step = order.scheduledAt ? "Request a resend before the scan slot." : "Request a resend.";
  return `${verdict} ${step}`;
}

function stepLine(order: Order, now: Date): string {
  if (order.status === "processing" && order.step) return stepProgress(order.step, order.detail);
  if (isClosed(order.status)) return closedStep(order);
  if (slotIsTheBlocker(order, now)) return "Reschedule scan: slot before insurer turnaround";
  return reasonStep(order);
}

function slotIsTheBlocker(order: Order, now: Date): boolean {
  if (isClosed(order.status) || order.status === "processing" || !order.scheduledAt) return false;
  const scanAt = parseDemoInstant(order.scheduledAt);
  const risk = computeTimeRisk({ scanAt, insurer: order.insurer, status: order.status, now });
  const time = risk === "slot_at_risk" || risk === "at_risk" || isSubmitAtRisk({ scanAt, insurer: order.insurer, status: order.status, now });
  if (!time) return false;
  return order.reasonCode === "PORTAL_UPLOAD" || order.reasonCode === "CONFIRM_AFTER_FIX" || order.reasonCode === "MEMBER_ID_MISSING";
}

function reasonStep(order: Order): string {
  const detail = order.detail;
  const text = (key: string) => {
    const value = detail[key];
    return value == null ? "" : String(value).trim();
  };
  switch (order.reasonCode) {
    case "MISSING_DOCUMENTS":
    case "MORE_INFO_REQUESTED": {
      const doc = text("document") || text("items") || "records";
      const source = text("source") || text("insurer");
      return source ? `Chase ${doc} · ${source}` : `Chase ${doc}`;
    }
    case "SIDE_MISMATCH":
      return `Fix side mismatch (order ${sideLetter(text("side"))}, records ${sideLetter(text("otherSide"))})`;
    case "PORTAL_UPLOAD":
      return `Upload to ${payerShort(text("insurer") || order.insurer || "the")} portal`;
    case "RETURN_TO_PROVIDER":
      return `Send to ${doctorName(text("doctor"))}`;
    case "UNREADABLE_DOCUMENT":
    case "NO_MATCH":
      return "Request a clean copy";
    case "WRONG_PATIENT_PAGE":
      return "Request this patient's record";
    case "INSURER_MISMATCH":
      return "Confirm the active plan";
    case "CPT_MISMATCH":
      return "Correct the CPT";
    case "MEMBER_ID_MISSING":
      return "Add the member ID";
    case "SUBMISSION_FAILED":
      return "Retry the upload";
    case "STATUS_CHECK_FAILED":
      return "Check the insurer again";
    case "APPROVAL_MISMATCH":
      return "Match the approval to the order";
    case "WRITEBACK_FAILED":
      return "Retry the Epic write";
    case "CRITERIA_NOT_MET":
    case "PEER_TO_PEER":
      return `Send to ${doctorName(text("doctor"))}`;
    case "RULE_GAP":
      return "Review the missing policy";
    case "CONFIRM_AFTER_FIX":
      return "Confirm the fix";
    case "REPEATED_REQUESTS":
      return "Decide whether to proceed";
    case "DENIED_DECIDE_APPEAL":
      return "Decide on the appeal";
    case "INITIAL_REQUEST":
    case "AWAITING_DECISION":
    case "PENDED_BY_INSURER":
    case "APPEAL":
      return "Wait for the decision";
    default:
      return order.reasonCode ? whatToDo(order.reasonCode, order.detail).replace(/\.$/, "") : "Review the order";
  }
}

function closedStep(order: Order): string {
  switch (order.status) {
    case "approved":
      return "Filed in Epic";
    case "not_required":
      return "Marked not required";
    case "denied":
      return "Closed the denial";
    default:
      return "Cancelled the order";
  }
}

function clipStep(text: string): string {
  const clean = text.replace(/\s+/g, " ").replace(/\.$/, "").trim();
  if (clean.length <= STEP_LIMIT) return clean;
  const cut = clean.slice(0, STEP_LIMIT);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

function sideLetter(value: string): string {
  const side = value.toLowerCase();
  if (side.startsWith("l")) return "L";
  if (side.startsWith("r")) return "R";
  return value ? value.slice(0, 1).toUpperCase() : "?";
}

function payerShort(insurer: string): string {
  return insurer.split(/\s+/)[0] || insurer;
}

function doctorName(value: string): string {
  const trimmed = value.replace(/\(.*?\)/g, "").replace(/'s office.*/i, "").trim();
  if (!trimmed) return "the ordering doctor";
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  return trimmed;
}

import type {
  AdminReason,
  ApprovedReason,
  CancelledReason,
  ClinicalReason,
  DeniedReason,
  NotRequiredReason,
  OrderSnapshot,
  OrderStatus,
  ProcessingStep,
  ReasonCode,
  ReasonDetail,
  SubmittedReason,
  UserRole,
} from "./types";
import { STEP_LABEL } from "./catalog";

export const ADMIN_REASONS = [
  "UNREADABLE_DOCUMENT",
  "NO_MATCH",
  "MISSING_DOCUMENTS",
  "SIDE_MISMATCH",
  "WRONG_PATIENT_PAGE",
  "INSURER_MISMATCH",
  "CPT_MISMATCH",
  "PORTAL_UPLOAD",
  "SUBMISSION_FAILED",
  "MORE_INFO_REQUESTED",
  "STATUS_CHECK_FAILED",
  "APPROVAL_MISMATCH",
  "WRITEBACK_FAILED",
] as const satisfies readonly AdminReason[];

export const CLINICAL_REASONS = [
  "CRITERIA_NOT_MET",
  "RULE_GAP",
  "CONFIRM_AFTER_FIX",
  "REPEATED_REQUESTS",
  "DENIED_DECIDE_APPEAL",
  "PEER_TO_PEER",
] as const satisfies readonly ClinicalReason[];

export const SUBMITTED_REASONS = ["INITIAL_REQUEST", "AWAITING_DECISION", "PENDED_BY_INSURER", "APPEAL"] as const satisfies readonly SubmittedReason[];

export const APPROVED_REASONS = ["NEW", "LINKED_EXISTING", "APPEAL_WON"] as const satisfies readonly ApprovedReason[];

export const NOT_REQUIRED_REASONS = ["NOT_ON_PA_LIST", "SETTING_EXEMPT"] as const satisfies readonly NotRequiredReason[];

export const DENIED_REASONS = ["NO_APPEAL", "APPEAL_LOST"] as const satisfies readonly DeniedReason[];

export const CANCELLED_REASONS = [
  "EPIC_CANCELLED",
  "WITHDRAWN_BY_NURSE",
  "WITHDRAWN_BY_COORDINATOR",
  "SLOT_RELEASED",
] as const satisfies readonly CancelledReason[];

export const REASON_CODES = [
  ...ADMIN_REASONS,
  ...CLINICAL_REASONS,
  ...SUBMITTED_REASONS,
  ...APPROVED_REASONS,
  ...NOT_REQUIRED_REASONS,
  ...DENIED_REASONS,
  ...CANCELLED_REASONS,
] as const satisfies readonly ReasonCode[];

const REASONS_FOR: Record<OrderStatus, readonly ReasonCode[]> = {
  PROCESSING: [],
  NEEDS_ADMIN_REVIEW: ADMIN_REASONS,
  NEEDS_CLINICAL_REVIEW: CLINICAL_REASONS,
  SUBMITTED: SUBMITTED_REASONS,
  APPROVED: APPROVED_REASONS,
  NOT_REQUIRED: NOT_REQUIRED_REASONS,
  DENIED: DENIED_REASONS,
  CANCELLED: CANCELLED_REASONS,
};

export function reasonsFor(status: OrderStatus): readonly ReasonCode[] {
  return REASONS_FOR[status];
}

export function reasonFits(status: OrderStatus, reason: ReasonCode | null): boolean {
  if (status === "PROCESSING") return reason == null;
  return reason != null && REASONS_FOR[status].includes(reason);
}

export const REASON_CHIP: Record<ReasonCode, string> = {
  UNREADABLE_DOCUMENT: "Unreadable",
  NO_MATCH: "No match",
  MISSING_DOCUMENTS: "Missing docs",
  SIDE_MISMATCH: "Side mismatch",
  WRONG_PATIENT_PAGE: "Wrong-patient page",
  INSURER_MISMATCH: "Insurer mismatch",
  CPT_MISMATCH: "CPT mismatch",
  PORTAL_UPLOAD: "Portal upload",
  SUBMISSION_FAILED: "Submission failed",
  MORE_INFO_REQUESTED: "Insurer asked",
  STATUS_CHECK_FAILED: "Check failed",
  APPROVAL_MISMATCH: "Approval mismatch",
  WRITEBACK_FAILED: "Epic write failed",
  CRITERIA_NOT_MET: "Criteria not met",
  RULE_GAP: "Rule gap",
  CONFIRM_AFTER_FIX: "Confirm after fix",
  REPEATED_REQUESTS: "Repeated requests",
  DENIED_DECIDE_APPEAL: "Denied",
  PEER_TO_PEER: "Peer-to-peer",
  INITIAL_REQUEST: "With insurer",
  AWAITING_DECISION: "With insurer",
  PENDED_BY_INSURER: "Pended",
  APPEAL: "Appeal",
  NEW: "New approval",
  LINKED_EXISTING: "Linked approval",
  APPEAL_WON: "Appeal won",
  NOT_ON_PA_LIST: "Not on PA list",
  SETTING_EXEMPT: "Setting exempt",
  NO_APPEAL: "No appeal",
  APPEAL_LOST: "Appeal lost",
  EPIC_CANCELLED: "Epic cancelled",
  WITHDRAWN_BY_NURSE: "Withdrawn by nurse",
  WITHDRAWN_BY_COORDINATOR: "Withdrawn by coordinator",
  SLOT_RELEASED: "Slot released",
};

/** Case-page first line. Every `{name}` is a key in the reason's detail. */
export const REASON_TEMPLATE: Record<ReasonCode, string> = {
  UNREADABLE_DOCUMENT: "Couldn't read {document}: {problem}. Sender: {sender}.",
  NO_MATCH: "Couldn't match to an order. Found: {name}, DOB {dob}, MRN {mrn}. Closest: {candidates}.",
  MISSING_DOCUMENTS: "Waiting on {document} from {source}. Requested {requested}; next follow-up {followUp}. Needed for: {criterion}.",
  SIDE_MISMATCH: "Order says {side} {bodyPart}; {n} records say {otherSide}: {records}.",
  WRONG_PATIENT_PAGE: "Page {page} is for another patient ({name}, DOB {dob}). Removed from the packet and reported to privacy.",
  INSURER_MISMATCH: "Order lists {insurerA}; {source} shows {insurerB} from {date}.",
  CPT_MISMATCH: "CPT {cpt} doesn't match {what}.",
  PORTAL_UPLOAD: "Meets all {n} criteria. Upload to the {insurer} portal: {k} attachments, in order.",
  SUBMISSION_FAILED: "{insurer} {channel} rejected the request after {n} attempts: {error}.",
  MORE_INFO_REQUESTED: "{insurer} asked for: {items}. Due {date}.",
  STATUS_CHECK_FAILED: "Couldn't get a status from {insurer} since {time}: {error}. Last known: {normalized}.",
  APPROVAL_MISMATCH: "{insurer} approved {approved}, but the order is for {ordered}.",
  WRITEBACK_FAILED: "Approval {number} received but couldn't be saved to Epic: {error}.",
  CRITERIA_NOT_MET: "Doesn't meet {policy}: {failures}. Suggested: {action}.",
  RULE_GAP: "{insurer} requires approval for {cpt}, but there are no {insurer} rules for this study. Review against the insurer's published policy.",
  CONFIRM_AFTER_FIX: "Coordinator supplied {item}. Now meets all {n} criteria. Changed since last check: {diff}.",
  REPEATED_REQUESTS: "{items} requested 3 times without success ({dates}). Decide whether to proceed, cancel or call the clinic.",
  DENIED_DECIDE_APPEAL: "{denialLine}",
  PEER_TO_PEER: "{insurer} asked for a peer-to-peer by {deadline}. Call {phone}.",
  INITIAL_REQUEST: "Sent to {insurer} via {channel} on {date}, ref {ref}. Last checked {time}.",
  AWAITING_DECISION: "Sent to {insurer} via {channel} on {date}, ref {ref}. Last checked {time}: {normalized}.",
  PENDED_BY_INSURER: "{insurer} pended the request on {date}: \"{rawReason}\".",
  APPEAL: "Appeal sent {date}, ref {ref}. Decision due by {due}.",
  NEW: "Approval {number} written to Epic for CPT {cpt}, valid {validFrom} to {validTo}.",
  LINKED_EXISTING: "Linked existing approval {number} for CPT {cpt}, valid {validFrom} to {validTo}. Nothing was submitted.",
  APPEAL_WON: "Appeal approved. Approval {number} written to Epic, valid {validFrom} to {validTo}.",
  NOT_ON_PA_LIST: "No approval needed. {cpt} is not on {insurer}'s prior-auth list.",
  SETTING_EXEMPT: "No approval needed. {setting} is exempt for {insurer}.",
  NO_APPEAL: "Closed as denied on {date}. The nurse did not appeal.",
  APPEAL_LOST: "Appeal denied on {date}: {denialReason}. This denial is final.",
  EPIC_CANCELLED: "Epic cancelled this order on {date}.",
  WITHDRAWN_BY_NURSE: "A nurse withdrew this order on {date}: {why}.",
  WITHDRAWN_BY_COORDINATOR: "A coordinator withdrew this order on {date}: {why}.",
  SLOT_RELEASED: "The scan slot was released and the order was cancelled on {date}.",
};

export const WHAT_TO_DO: Record<ReasonCode, string> = {
  UNREADABLE_DOCUMENT: "Request a clean copy of {document} from {sender}.",
  NO_MATCH: "Link this packet to the right order.",
  MISSING_DOCUMENTS: "Chase {document} from {source}.",
  SIDE_MISMATCH: "Ask {doctor} to change the order to the {otherSide} {bodyPart}.",
  WRONG_PATIENT_PAGE: "Request this patient's own record from {sender}.",
  INSURER_MISMATCH: "Verify coverage and update registration to {insurerB}.",
  CPT_MISMATCH: "Ask {doctor} to correct CPT {cpt}.",
  PORTAL_UPLOAD: "Upload {k} attachments to the {insurer} portal, then enter the reference.",
  SUBMISSION_FAILED: "Fix the data and retry, or upload the packet to the {insurer} portal.",
  MORE_INFO_REQUESTED: "Gather {items} for {insurer}.",
  STATUS_CHECK_FAILED: "Check {insurer} again, or record the status from the portal.",
  APPROVAL_MISMATCH: "Correct the order or the approval so they match.",
  WRITEBACK_FAILED: "Retry the Epic write, or mark it written with the Epic auth id.",
  CRITERIA_NOT_MET: "Talk to {doctor} about {policy}.",
  RULE_GAP: "Review {cpt} against {insurer}'s published policy.",
  CONFIRM_AFTER_FIX: "Confirm {item}, then approve the packet for submission.",
  REPEATED_REQUESTS: "Decide whether to proceed, cancel, or call the clinic.",
  DENIED_DECIDE_APPEAL: "Decide whether to file the appeal or close the denial.",
  PEER_TO_PEER: "Book the peer-to-peer with {doctor}, then record the outcome.",
  INITIAL_REQUEST: "Wait for {insurer} to decide.",
  AWAITING_DECISION: "Wait for {insurer} to decide.",
  PENDED_BY_INSURER: "Read why {insurer} pended the request.",
  APPEAL: "Wait for the appeal decision.",
  NEW: "Nothing further. The approval is in Epic.",
  LINKED_EXISTING: "Nothing further. The existing approval covers this scan.",
  APPEAL_WON: "Nothing further. The appeal approval is in Epic.",
  NOT_ON_PA_LIST: "Nothing further. Mark the order not required in Epic.",
  SETTING_EXEMPT: "Nothing further. This setting does not need approval.",
  NO_APPEAL: "Nothing further. Scheduling has the denial.",
  APPEAL_LOST: "Nothing further. Scheduling has the denial.",
  EPIC_CANCELLED: "Nothing further. Epic already cancelled the order.",
  WITHDRAWN_BY_NURSE: "Nothing further. The order is withdrawn.",
  WITHDRAWN_BY_COORDINATOR: "Nothing further. The order is withdrawn.",
  SLOT_RELEASED: "Nothing further. The slot is released.",
};

export type ActionRequirement = "note" | "portalReference" | "approval" | "epicAuthId";

export interface StatusAction {
  id: string;
  label: string;
  to: OrderStatus | null;
  roles: Array<"coordinator" | "nurse">;
  requires: ActionRequirement[];
  /** Destination reason when this action changes status. */
  reason: ReasonCode | null;
  /** PROCESSING step when the action returns the order to the pipeline. */
  step?: ProcessingStep;
  trigger?: "send_for_documents" | "approve_for_submission";
}

const back = (id: string, label: string, step: ProcessingStep, roles: Array<"coordinator" | "nurse">, requires: ActionRequirement[] = [], trigger?: StatusAction["trigger"]): StatusAction => ({
  id,
  label,
  to: "PROCESSING",
  roles,
  requires,
  reason: null,
  step,
  trigger,
});

/** Buttons for this reason and role, in display order. The first one is the primary action. */
export const REASON_ACTIONS: Record<ReasonCode, readonly StatusAction[]> = {
  UNREADABLE_DOCUMENT: [
    { id: "request_clean_copy", label: "Request a clean copy", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("copy_received", "Copy received", "INTAKE", ["coordinator"]),
  ],
  NO_MATCH: [back("linked_to_order", "Linked to order", "MATCHING", ["coordinator"])],
  MISSING_DOCUMENTS: [
    { id: "resend_request", label: "Resend request", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("documents_received", "Documents received", "INTAKE", ["coordinator"]),
  ],
  SIDE_MISMATCH: [
    { id: "notify_ordering_doctor", label: "Notify ordering doctor", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("correction_made", "Correction made", "INTAKE", ["coordinator"]),
  ],
  WRONG_PATIENT_PAGE: [
    { id: "request_patient_record", label: "Request this patient's record", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("correction_made", "Correction made", "INTAKE", ["coordinator"]),
  ],
  INSURER_MISMATCH: [back("correction_made", "Correction made", "COVERAGE", ["coordinator"])],
  CPT_MISMATCH: [
    { id: "notify_ordering_doctor", label: "Notify ordering doctor", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("correction_made", "Correction made", "INTAKE", ["coordinator"]),
  ],
  PORTAL_UPLOAD: [
    { id: "open_packet", label: "Open packet", to: null, roles: ["coordinator"], requires: [], reason: null },
    { id: "uploaded", label: "Uploaded", to: "SUBMITTED", roles: ["coordinator"], requires: ["portalReference"], reason: "INITIAL_REQUEST" },
  ],
  SUBMISSION_FAILED: [
    back("retry", "Retry", "SUBMITTING", ["coordinator"]),
    { id: "uploaded", label: "Uploaded", to: "SUBMITTED", roles: ["coordinator"], requires: ["portalReference"], reason: "INITIAL_REQUEST" },
  ],
  MORE_INFO_REQUESTED: [back("gather_requested_items", "Gather requested items", "EVIDENCE", ["coordinator"])],
  STATUS_CHECK_FAILED: [
    { id: "check_now", label: "Check now", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
    { id: "record_status", label: "Record status manually", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
  ],
  APPROVAL_MISMATCH: [
    { id: "notify_ordering_doctor", label: "Notify ordering doctor", to: null, roles: ["coordinator"], requires: [], reason: null },
    back("approval_corrected", "Approval corrected", "COVERAGE", ["coordinator"]),
  ],
  WRITEBACK_FAILED: [
    { id: "retry_write", label: "Retry write", to: null, roles: ["coordinator"], requires: [], reason: null },
    { id: "mark_written", label: "Mark written manually", to: "APPROVED", roles: ["coordinator"], requires: ["epicAuthId"], reason: "NEW" },
  ],
  CRITERIA_NOT_MET: [
    back("approve_for_submission", "Approve for submission", "SUBMITTING", ["nurse"], ["note"], "approve_for_submission"),
    { id: "cancel_order", label: "Cancel order", to: "CANCELLED", roles: ["nurse"], requires: [], reason: "WITHDRAWN_BY_NURSE" },
    back("send_for_documents", "Send for documents", "INTAKE", ["nurse"], [], "send_for_documents"),
    { id: "message_ordering_doctor", label: "Message ordering doctor", to: null, roles: ["nurse"], requires: [], reason: null },
  ],
  RULE_GAP: [
    back("approve_for_submission", "Approve for submission", "SUBMITTING", ["nurse"], ["note"], "approve_for_submission"),
    { id: "cancel_order", label: "Cancel order", to: "CANCELLED", roles: ["nurse"], requires: [], reason: "WITHDRAWN_BY_NURSE" },
  ],
  CONFIRM_AFTER_FIX: [
    back("approve_for_submission", "Approve for submission", "SUBMITTING", ["nurse"], ["note"], "approve_for_submission"),
    back("send_for_documents", "Send for documents", "INTAKE", ["nurse"], [], "send_for_documents"),
  ],
  REPEATED_REQUESTS: [
    back("approve_for_submission", "Approve for submission", "SUBMITTING", ["nurse"], ["note"], "approve_for_submission"),
    { id: "cancel_order", label: "Cancel order", to: "CANCELLED", roles: ["nurse"], requires: [], reason: "WITHDRAWN_BY_NURSE" },
    back("send_for_documents", "Send for documents", "INTAKE", ["nurse"], [], "send_for_documents"),
  ],
  DENIED_DECIDE_APPEAL: [
    { id: "file_appeal", label: "File appeal", to: "SUBMITTED", roles: ["nurse"], requires: [], reason: "APPEAL" },
    { id: "close_as_denied", label: "Close as denied", to: "DENIED", roles: ["nurse"], requires: [], reason: "NO_APPEAL" },
    { id: "request_peer_to_peer", label: "Request peer-to-peer", to: null, roles: ["nurse"], requires: [], reason: null },
  ],
  PEER_TO_PEER: [
    { id: "record_outcome", label: "Record outcome", to: null, roles: ["nurse"], requires: [], reason: null },
    { id: "message_ordering_doctor", label: "Message ordering doctor", to: null, roles: ["nurse"], requires: [], reason: null },
  ],
  INITIAL_REQUEST: [
    { id: "record_approval", label: "Record approval", to: "APPROVED", roles: ["coordinator"], requires: ["approval"], reason: "NEW" },
    { id: "insurer_asked", label: "Insurer asked for more", to: "NEEDS_ADMIN_REVIEW", roles: ["coordinator"], requires: [], reason: "MORE_INFO_REQUESTED" },
    { id: "insurer_denied", label: "Insurer denied", to: "NEEDS_CLINICAL_REVIEW", roles: ["coordinator"], requires: [], reason: "DENIED_DECIDE_APPEAL" },
    { id: "check_now", label: "Check now", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
  ],
  AWAITING_DECISION: [
    { id: "check_now", label: "Check now", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
  ],
  PENDED_BY_INSURER: [
    { id: "check_now", label: "Check now", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
  ],
  APPEAL: [
    { id: "record_approval", label: "Record approval", to: "APPROVED", roles: ["coordinator"], requires: ["approval"], reason: "APPEAL_WON" },
    { id: "appeal_denied", label: "Appeal denied", to: "NEEDS_CLINICAL_REVIEW", roles: ["coordinator"], requires: [], reason: "DENIED_DECIDE_APPEAL" },
    { id: "check_now", label: "Check now", to: null, roles: ["coordinator", "nurse"], requires: [], reason: null },
  ],
  NEW: [],
  LINKED_EXISTING: [],
  APPEAL_WON: [],
  NOT_ON_PA_LIST: [],
  SETTING_EXEMPT: [],
  NO_APPEAL: [],
  APPEAL_LOST: [],
  EPIC_CANCELLED: [],
  WITHDRAWN_BY_NURSE: [],
  WITHDRAWN_BY_COORDINATOR: [],
  SLOT_RELEASED: [],
};

export function viewerRole(role: UserRole): "coordinator" | "nurse" {
  return role === "coordinator" ? "coordinator" : "nurse";
}

export function actionsFor(order: Pick<OrderSnapshot, "reason">, role: UserRole): StatusAction[] {
  if (!order.reason) return [];
  const viewer = viewerRole(role);
  return REASON_ACTIONS[order.reason].filter((action) => action.roles.includes(viewer)).map((action) => ({ ...action }));
}

export function primaryAction(order: Pick<OrderSnapshot, "reason">, role: UserRole): StatusAction | null {
  return actionsFor(order, role)[0] ?? null;
}

export function reasonChip(code: ReasonCode): string {
  return REASON_CHIP[code];
}

export function stepProgress(step: ProcessingStep, detail: ReasonDetail = {}): string {
  return fill(STEP_LABEL[step], {
    insurer: detail.insurer ?? "the insurer",
    n: detail.n ?? "the",
  });
}

export function fill(template: string, detail: ReasonDetail): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => {
    const value = detail[key];
    return value == null || value === "" ? `{${key}}` : String(value);
  });
}

export function explainReason(code: ReasonCode, detail: ReasonDetail): string {
  return fill(REASON_TEMPLATE[code], denialLine(code, detail));
}

export function whatToDo(code: ReasonCode, detail: ReasonDetail): string {
  return fill(WHAT_TO_DO[code], detail);
}

function denialLine(code: ReasonCode, detail: ReasonDetail): ReasonDetail {
  if (code !== "DENIED_DECIDE_APPEAL") return detail;
  if (detail.denialLine) return detail;
  const reason = detail.reason ?? detail.denialReason ?? "the request";
  const deadline = detail.deadline ?? detail.date ?? "the insurer deadline";
  const days = detail.days ?? detail.n ?? "a few";
  const line = `${detail.insurer} denied on ${detail.date}: "${reason}". Appeal by ${deadline} (${days} days left). Draft ready.`;
  return { ...detail, denialLine: line, reason, deadline, days };
}

/** One complete detail per reason, used to prove every template fills. */
export const EXAMPLE_DETAILS: Record<ReasonCode, ReasonDetail> = {
  UNREADABLE_DOCUMENT: { document: "the fax", problem: "all pages blank", sender: "Promenade Urgent Care 555-0148" },
  NO_MATCH: { name: "Rom", dob: "01/11/1975", mrn: "none", candidates: "Nog, HH-0017214" },
  MISSING_DOCUMENTS: { document: "PT notes", source: "Utopia Planitia Rehab", requested: "Nov 9", followUp: "Nov 10", criterion: "conservative care" },
  SIDE_MISMATCH: { side: "left", bodyPart: "knee", n: 3, otherSide: "right", records: "office note p.2, PT p.3, X-ray p.5", doctor: "Dr. Bashir-Mora's office (410) 555-0109" },
  WRONG_PATIENT_PAGE: { page: 3, name: "Rom", dob: "01/11/1975", sender: "the clinic" },
  INSURER_MISMATCH: { insurerA: "Federation Health", source: "card scanned Nov 9", insurerB: "Bajoran Health Plan", date: "Nov 1" },
  CPT_MISMATCH: { cpt: "73721", what: "the shoulder procedure", doctor: "the ordering doctor" },
  PORTAL_UPLOAD: { n: 4, insurer: "Ferengi Benefit Group", k: 5 },
  SUBMISSION_FAILED: { insurer: "Federation Health", channel: "API", error: "member id rejected", n: 3 },
  MORE_INFO_REQUESTED: { insurer: "Federation Health", items: "PT notes and the X-ray", date: "Nov 12" },
  STATUS_CHECK_FAILED: { insurer: "Andorian Life", time: "2:00 PM", error: "Page changed", normalized: "In review" },
  APPROVAL_MISMATCH: { insurer: "Klingon Assurance", approved: "CPT 78816", ordered: "CPT 78815" },
  WRITEBACK_FAILED: { number: "A-100", error: "Epic timed out" },
  CRITERIA_NOT_MET: { policy: "IMG-330", failures: "3 weeks of symptoms (needs 6)", action: "talk to the ordering doctor", doctor: "the ordering doctor" },
  RULE_GAP: { insurer: "Bajoran Health Plan", cpt: "72148" },
  CONFIRM_AFTER_FIX: { item: "PT notes", n: 4, diff: "conservative care is now met" },
  REPEATED_REQUESTS: { items: "PT notes", dates: "Nov 1, Nov 4, Nov 8" },
  DENIED_DECIDE_APPEAL: { insurer: "Federation Health", date: "Nov 9", denialReason: "not medically necessary", reason: "not medically necessary", deadline: "Nov 19", days: 10, appeal: "first" },
  PEER_TO_PEER: { insurer: "Federation Health", deadline: "Nov 12", phone: "(415) 555-0199", doctor: "the ordering doctor" },
  INITIAL_REQUEST: { insurer: "Federation Health", channel: "API", date: "Nov 9", ref: "FH-100", time: "4:00 PM" },
  AWAITING_DECISION: { insurer: "Federation Health", channel: "API", date: "Nov 9", ref: "FH-100", time: "4:00 PM", normalized: "In review" },
  PENDED_BY_INSURER: { insurer: "Ferengi Benefit Group", date: "Nov 10", rawReason: "clinical review" },
  APPEAL: { date: "Nov 10", ref: "FH-100-A", due: "Nov 20" },
  NEW: { number: "A-100", cpt: "72148", validFrom: "Nov 1", validTo: "Feb 1" },
  LINKED_EXISTING: { number: "FH-AUTH-2026-118842", cpt: "72148", validFrom: "Nov 1", validTo: "Feb 4" },
  APPEAL_WON: { number: "A-200", cpt: "72148", validFrom: "Nov 12", validTo: "Feb 12" },
  NOT_ON_PA_LIST: { cpt: "74177", insurer: "Bajoran Health Plan" },
  SETTING_EXEMPT: { setting: "Inpatient", insurer: "Federation Health" },
  NO_APPEAL: { date: "Nov 11" },
  APPEAL_LOST: { date: "Nov 14", denialReason: "criteria still not met" },
  EPIC_CANCELLED: { date: "Nov 9" },
  WITHDRAWN_BY_NURSE: { date: "Nov 9", why: "the study should not go ahead" },
  WITHDRAWN_BY_COORDINATOR: { date: "Nov 9", why: "the clinic withdrew the order" },
  SLOT_RELEASED: { date: "Nov 9" },
};

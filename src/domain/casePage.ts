// Presentation for the case page. Status, reasons and transitions stay in the prior-auth model.

import type { ExtractRow, CaseRecord, Cite } from "@/domain/caseRecord";
import { pdfPageFor } from "@/domain/documents";
import { channelLine, policyFieldCite } from "@/domain/casePane";
import { contactFor } from "@/domain/directory";
import { memberIdFor } from "@/domain/memberId";
import { actionsFor, type StatusAction } from "@/domain/priorAuth/actions";
import type { ReasonCode, UserRole } from "@/domain/priorAuth/types";
import { normalizeProvider } from "@/domain/providers";
import type { CheckRow, ReviewPanel } from "@/domain/review/types";
import type { Order } from "@/domain/types";
import { parseDemoInstant } from "@/lib/demoClock";
import { fmtTableDate } from "@/lib/format";
import { PLAN_TYPE_LABEL, label } from "@/lib/labels";
import { eligibilityFor } from "@/lib/mocks/eligibility";

export interface CaseButton {
  id: string;
  label: string;
  action: StatusAction | null;
}

const WANTED: Partial<Record<ReasonCode, Array<{ id: string; label: string }>>> = {
  INSURER_MISMATCH: [
    { id: "run_eligibility", label: "Run eligibility" },
    { id: "correction_made", label: "Update registration" },
  ],
  SIDE_MISMATCH: [
    { id: "notify_ordering_doctor", label: "Notify ordering doctor" },
    { id: "correction_made", label: "Correction made" },
  ],
  CPT_MISMATCH: [
    { id: "notify_ordering_doctor", label: "Notify ordering doctor" },
    { id: "correction_made", label: "Correction made" },
  ],
  MISSING_DOCUMENTS: [
    { id: "resend_request", label: "Request resend" },
    { id: "documents_received", label: "Documents received" },
  ],
  UNREADABLE_DOCUMENT: [
    { id: "request_clean_copy", label: "Request resend" },
    { id: "copy_received", label: "Documents received" },
  ],
  WRONG_PATIENT_PAGE: [
    { id: "request_patient_record", label: "Request correct record" },
    { id: "correction_made", label: "Correction made" },
  ],
  PORTAL_UPLOAD: [
    { id: "uploaded", label: "Mark uploaded" },
    { id: "open_packet", label: "Open packet" },
  ],
  RETURN_TO_PROVIDER: [
    { id: "send_draft", label: "Send draft" },
    { id: "release_slot", label: "Release slot" },
  ],
  CRITERIA_NOT_MET: [
    { id: "approve_for_submission", label: "Approve for submission" },
    { id: "cancel_order", label: "Cancel order" },
  ],
  RULE_GAP: [
    { id: "approve_for_submission", label: "Approve for submission" },
    { id: "cancel_order", label: "Cancel order" },
  ],
  CONFIRM_AFTER_FIX: [
    { id: "approve_for_submission", label: "Approve for submission" },
    { id: "cancel_order", label: "Cancel order" },
  ],
  DENIED_DECIDE_APPEAL: [
    { id: "file_appeal", label: "File appeal" },
    { id: "close_as_denied", label: "Close as denied" },
  ],
};

/** At most two buttons, from the reason's legal actions for this role. */
export function caseButtons(reason: ReasonCode | null, role: UserRole): CaseButton[] {
  if (!reason) return [];
  const wanted = WANTED[reason];
  if (!wanted) return [];
  const legal = new Map(actionsFor({ reason }, role).map((action) => [action.id, action]));
  const buttons: CaseButton[] = [];
  for (const item of wanted) {
    if (item.id === "run_eligibility") {
      if (role === "coordinator") buttons.push({ id: item.id, label: item.label, action: null });
      continue;
    }
    const action = legal.get(item.id);
    if (action) buttons.push({ id: item.id, label: item.label, action });
  }
  return buttons.slice(0, 2);
}

export interface OrderField {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  cite?: { docId: string; page: number; quote?: string; label?: string };
  origin?: "epic";
  lastRun?: string;
  handwritten?: boolean;
  unparsed?: boolean;
}

function isCard(row: ExtractRow): boolean {
  return row.section === "Card" || /insurance card/i.test(`${row.label} ${row.excerpt}`);
}

function ranLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return fmtTableDate(parseDemoInstant(iso));
}

function memberCite(record: CaseRecord, page: number, quote: string): Cite {
  const doc =
    record.documents.find((item) => item.pdfPageByDocPage?.includes(page) || pdfPageFor(item, 1) === page) ??
    record.documents[0];
  const mapped = doc?.pdfPageByDocPage?.indexOf(page) ?? -1;
  const docPage = mapped >= 0 ? mapped + 1 : doc ? Math.max(1, page - doc.filePageStart + 1) : page;
  return { docId: doc?.id ?? "packet", page: docPage, quote };
}

export function orderFields(order: Order, record: CaseRecord, panel: ReviewPanel): OrderField[] {
  const provider = record.elements.find((item) => item.label === "Ordering provider");
  const providerName = provider ? normalizeProvider(provider.value) : null;
  const slot = record.elements.find((item) => item.label === "Scan slot");
  const member = memberIdFor(order);
  const card = record.extracted.find(isCard);
  const cardNamed = Boolean(card) || /card/i.test(String(order.detail.source ?? ""));
  const eligibilityFailed = panel.coverage.some((row) => row.id === "CV-1" && row.result === "NOT_MET");
  const pending = order.reasonCode === "INSURER_MISMATCH" || eligibilityFailed;
  const plan = order.plan ?? (eligibilityFor(order.patient?.mrn)?.planType ? label(PLAN_TYPE_LABEL, eligibilityFor(order.patient?.mrn)?.planType ?? "") : null);
  const insurance = [order.insurer, plan, member?.value].filter(Boolean).join(" · ") || "Not on the order";
  const providerContact = contactFor(provider?.value);
  const providerValue = providerName ? (providerName.parsed ? providerName.detail : providerName.raw) : "Not on the order";
  const providerBits = [providerValue !== "Not on the order" ? providerValue : "", providerContact?.npi ? `NPI ${providerContact.npi}` : "", providerContact?.phone ?? ""].filter(Boolean);
  const examName = order.side && order.study ? `${order.side} · ${order.study}` : order.study;
  const fields: OrderField[] = [
    { label: "Exam", value: [examName, order.cpt].filter(Boolean).join(" · ") || "Not on the order" },
    { label: "Diagnosis", value: "Not on the order", muted: true },
    { label: "Clinical question", value: "Not on the order", muted: true },
    { label: "Priority", value: order.priority },
    {
      label: "Ordering provider",
      value: providerBits.join(" · ") || "Not on the order",
      unparsed: providerName ? !providerName.parsed : false,
      ...(provider?.cite ? { cite: provider.cite } : {}),
    },
    {
      label: "Insurance",
      value: insurance,
      ...(member?.source === "pdf" && member.page && member.quote ? { cite: memberCite(record, member.page, member.quote) } : {}),
      ...(member?.source === "epic" ? { origin: "epic" as const, lastRun: ranLabel(member.ranAt) } : {}),
    },
  ];
  if (order.scheduledAt) {
    fields.push({
      label: "Scan slot",
      value: fmtTableDate(parseDemoInstant(order.scheduledAt)),
      handwritten: slot?.handwritten === true || order.scheduleHandwritten === true,
      ...(slot?.cite ? { cite: slot.cite } : {}),
      ...(slot?.origin === "epic" ? { origin: "epic" as const, lastRun: ranLabel(slot.ranAt) } : {}),
    });
  }
  if (cardNamed) {
    const named = order.detail.insurerB ? String(order.detail.insurerB) : "Card scanned";
    fields.push({ label: "Insurance on card", value: named });
  }
  const policyCite = pending ? null : policyFieldCite(order);
  fields.push({
    label: "Policy",
    value: pending ? "Pending coverage check" : (order.policyRef ?? order.plan ?? "Not on the order"),
    muted: pending,
    ...(policyCite ? { cite: policyCite } : {}),
  });
  const channel = channelLine(order);
  const policyField = fields.find((field) => field.label === "Policy");
  if (policyField && channel.cite && !policyField.cite) policyField.cite = channel.cite;
  fields.push({
    label: "Channel",
    value: channel.value,
    ...(channel.cite ? { cite: channel.cite } : {}),
  });
  for (const extra of REQUEST_OVERLAY[order.id] ?? []) {
    const index = fields.findIndex((field) => field.label === extra.label);
    if (index >= 0) fields[index] = { ...fields[index], ...extra };
    else fields.push(extra);
  }
  return fields;
}

const cite = (docId: string, page: number, quote: string): Cite => ({ docId, page, quote });

/** Packet lines the generic order row cannot see. Merged by label. */
const REQUEST_OVERLAY: Record<string, OrderField[]> = {
  "case-1-kirk": [
    { label: "Exam", value: "Right · MRI lumbar spine · 72148", cite: cite("kirk-order", 1, "MRI LUMBAR SPINE WO CONTRAST [72148]") },
    { label: "Diagnosis", value: "M54.16 Radiculopathy, lumbar region", muted: false, cite: cite("kirk-order", 1, "M54.16 Radiculopathy, lumbar region") },
    { label: "Clinical question", value: "Disc herniation and nerve root compression", muted: false, cite: cite("kirk-note", 1, "evaluate for disc herniation and nerve root compression") },
    { label: "Priority", value: "Routine", origin: "epic" },
    { label: "Ordering provider", value: "Leonard McCoy, MD · NPI 1700000017 · (410) 555-0188", cite: cite("kirk-order", 1, "Leonard McCoy, MD (NPI 1700000017)") },
  ],
  "case-2-scott": [
    { label: "Exam", value: "Right · MRI knee · 73721", cite: cite("scott-fax", 2, "MRI R knee w/o contrast") },
    { label: "Diagnosis", value: "M25.561 R knee pain", muted: false, cite: cite("scott-fax", 2, "R knee pain M25.561") },
    { label: "Clinical question", value: "Rule out medial meniscus tear", muted: false, cite: cite("scott-fax", 2, "r/o medial meniscus tear") },
    { label: "Priority", value: "Routine", cite: cite("scott-fax", 2, "Routine") },
    { label: "Ordering provider", value: "L. McCoy, MD · NPI 1700000017 · (410) 555-0188", cite: cite("scott-fax", 1, "(410) 555-0188") },
    { label: "Insurance", value: "Ferengi Benefit Group · Commercial HMO · FBG-0047-1979", cite: cite("scott-fax", 2, "FBG-0047-1979") },
  ],
  "case-3-sulu": [
    { label: "Exam", value: "Right · MRI shoulder · 73221", cite: cite("sulu-order", 1, "MRI SHOULDER RIGHT WO CONTRAST [73221]") },
    { label: "Diagnosis", value: "M25.511 Pain in right shoulder", muted: false, cite: cite("sulu-order", 1, "M25.511 Pain in right shoulder") },
    { label: "Clinical question", value: "R shoulder pain for 3 weeks after fencing", muted: false, cite: cite("sulu-note", 1, "R shoulder pain x 3 wks after fencing.") },
    { label: "Priority", value: "Routine", cite: cite("sulu-order", 1, "Priority: Routine") },
    { label: "Ordering provider", value: "Leonard McCoy, MD · NPI 1700000017 · (410) 555-0188", cite: cite("sulu-order", 1, "McCoy, Leonard, MD") },
    { label: "Insurance", value: "Andorian Life · Ice Planet Standard EPO · AL-1701-0914", cite: cite("sulu-order", 1, "AL-1701-0914") },
  ],
};

export interface DocRow {
  id: string;
  name: string;
  description: string;
  page: number;
  docId: string;
  quote?: string;
  image: boolean;
  problem: "unreadable" | "quarantined" | null;
}

function phrase(items: string[]): string {
  const names = items.map((item, index) => (index === 0 ? item : item.toLowerCase()));
  if (names.length <= 1) return names[0] ?? "No pages read";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function documentRows(record: CaseRecord, panel: ReviewPanel): DocRow[] {
  const packet = record.documents[0];
  const docId = packet?.id ?? "packet";
  const cards = record.extracted.filter(isCard);
  const body = record.extracted.filter((row) => !isCard(row));
  const packetDoc = panel.documents.find((doc) => doc.id === docId);
  const problem = packetDoc?.status === "UNREADABLE" ? "unreadable" : packetDoc?.status === "QUARANTINED" ? "quarantined" : null;
  const sections = [...new Set(body.map((row) => row.section))];
  const rows: DocRow[] = [
    {
      id: docId,
      name: packet?.title ?? packetDoc?.type ?? "Packet",
      description: problem === "unreadable" ? (body[0]?.excerpt ?? "Could not be read") : phrase(sections),
      page: body[0]?.cite.page ?? packet?.initialPage ?? 1,
      docId,
      ...(body[0]?.cite.quote ? { quote: body[0].cite.quote } : {}),
      image: false,
      problem,
    },
  ];
  for (const page of [...new Set(cards.map((row) => row.cite.page))]) {
    const row = cards.find((item) => item.cite.page === page)!;
    rows.push({
      id: `${docId}-card-${page}`,
      name: "Insurance card scan",
      description: "Image only, read by OCR",
      page,
      docId: row.cite.docId,
      quote: row.cite.quote,
      image: true,
      problem: null,
    });
  }
  for (const extra of panel.documents) {
    if (extra.id === docId) continue;
    const extraProblem = extra.status === "QUARANTINED" ? "quarantined" : extra.status === "UNREADABLE" ? "unreadable" : null;
    rows.push({
      id: extra.id,
      name: extra.type,
      description: extra.status === "QUARANTINED" ? "Removed from the packet" : extra.status === "UNREADABLE" ? "Could not be read" : `${extra.pages} pages`,
      page: 1,
      docId: extra.id,
      image: false,
      problem: extraProblem,
    });
  }
  return rows;
}

export function documentSummary(rows: DocRow[]): string {
  const noun = rows.length === 1 ? "document" : "documents";
  const parts = [`${rows.length} ${noun}`];
  const unreadable = rows.filter((row) => row.problem === "unreadable").length;
  const quarantined = rows.filter((row) => row.problem === "quarantined").length;
  if (unreadable) parts.push(`${unreadable} unreadable`);
  if (quarantined) parts.push(`${quarantined} quarantined`);
  return parts.join(" · ");
}

export type ChecklistItem =
  | { kind: "check"; row: CheckRow }
  | { kind: "collapse"; id: string; label: string; count: number; rows: CheckRow[] }
  | { kind: "waiting"; id: string; label: string; count: number };

export interface ChecklistGroup {
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistView {
  groups: ChecklistGroup[];
  summary: string;
}

const EXPLAINED: Partial<Record<ReasonCode, string>> = {
  INSURER_MISMATCH: "CV-1",
  SIDE_MISMATCH: "CO-1",
  CPT_MISMATCH: "CO-2",
  WRONG_PATIENT_PAGE: "CO-4",
};

function detailFor(order: Order, row: CheckRow): CheckRow {
  const explained = order.reasonCode ? EXPLAINED[order.reasonCode] : undefined;
  if (row.result === "NOT_MET" && explained === row.id) return { ...row, found: "See summary" };
  return row;
}

function collapseLabel(title: string, rows: CheckRow[]): string {
  if (title === "Consistency") return `Side, CPT, body part and patient agree on every page · ${rows.length} checks`;
  if (title === "Insurer criteria") return `All criteria passed · ${rows.length} checks`;
  return `${rows.length} checks passed`;
}

function presentGroup(title: string, rows: CheckRow[]): ChecklistGroup {
  if (rows.length === 0) return { title, items: [] };
  const open = rows.some((row) => row.result === "NOT_MET" || row.result === "UNCLEAR");
  if (!open && rows.every((row) => row.result === "MET") && rows.length > 1) {
    return {
      title,
      items: [{ kind: "collapse", id: title, label: collapseLabel(title, rows), count: rows.length, rows }],
    };
  }
  return { title, items: rows.map((row) => ({ kind: "check", row })) };
}

function countItems(items: ChecklistItem[]): { failed: number; unclear: number; passed: number; waiting: number } {
  const totals = { failed: 0, unclear: 0, passed: 0, waiting: 0 };
  for (const item of items) {
    if (item.kind === "waiting") totals.waiting += item.count;
    else if (item.kind === "collapse") totals.passed += item.count;
    else if (item.row.result === "NOT_MET") totals.failed += 1;
    else if (item.row.result === "UNCLEAR") totals.unclear += 1;
    else totals.passed += 1;
  }
  return totals;
}

export function checklistSummary(groups: ChecklistGroup[]): string {
  const totals = countItems(groups.flatMap((group) => group.items));
  const parts: string[] = [];
  if (totals.failed) parts.push(`${totals.failed} failed`);
  if (totals.unclear) parts.push(`${totals.unclear} unclear`);
  if (totals.passed) parts.push(`${totals.passed} passed`);
  if (totals.waiting) parts.push(`${totals.waiting} waiting on coverage`);
  return parts.join(" · ");
}

export function presentChecklist(order: Order, panel: ReviewPanel): ChecklistView {
  const insurerFailed =
    panel.coverage.some((row) => row.id === "CV-1" && row.result === "NOT_MET") ||
    panel.checks.consistency.some((row) => row.id === "CO-5" && row.result === "NOT_MET");
  const coverageSource = panel.coverage.find((row) => row.id === "CV-1");
  const coverageRows: CheckRow[] = [];
  if (coverageSource || insurerFailed) {
    const base: CheckRow = coverageSource ?? {
      id: "CV-1",
      result: insurerFailed ? "NOT_MET" : "MET",
      label: "Eligibility",
      found: insurerFailed ? "See summary" : "Eligibility matches",
    };
    coverageRows.push(
      detailFor(order, {
        ...base,
        id: "CV-1",
        label: "Insurer is active on the scan date",
        result: insurerFailed ? "NOT_MET" : base.result,
      }),
    );
  }
  const linked = panel.coverage.find((row) => row.id === "CV-2" && order.linkedApproval);
  if (linked) coverageRows.push(linked);

  const consistency = panel.checks.consistency
    .filter((row) => row.id !== "CO-5")
    .map((row) => detailFor(order, row));
  const criteria = panel.checks.criteria.rows.filter((row) => !row.id.startsWith("waiver:") && !row.id.startsWith("exception:"));
  const waiver = panel.checks.criteria.rows.filter((row) => row.id.startsWith("waiver:") || row.id.startsWith("exception:"));

  const groups: ChecklistGroup[] = [
    presentGroup("Coverage", coverageRows),
    presentGroup("Consistency", consistency),
  ];
  if (insurerFailed && criteria.length > 0) {
    groups.push({
      title: "Insurer criteria",
      items: [{ kind: "waiting", id: "waiting-coverage", label: "Waiting on coverage", count: criteria.length }],
    });
  } else {
    groups.push(presentGroup("Insurer criteria", [...criteria, ...waiver]));
  }
  const visible = groups.filter((group) => group.items.length > 0);
  return { groups: visible, summary: checklistSummary(visible) };
}

export function checklistCounts(view: ChecklistView): { failed: number; unclear: number; passed: number; waiting: number } {
  return countItems(view.groups.flatMap((group) => group.items));
}

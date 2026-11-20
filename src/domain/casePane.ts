// Left-pane facts that the checklist does not already own: who to call, waiver
// triggers, the treatment timeline, and whether the scan slot can still be met.

import { buildSeedDb } from "@/data/rules/seed";
import { medianDecisionHours } from "@/data/operations/throughput";
import type { CaseRecord } from "@/domain/caseRecord";
import { contactFor } from "@/domain/directory";
import { attachmentsOf, channelsOf, incompleteHandlingOf } from "@/domain/rules/policyProperties";
import type { PolicyVersion } from "@/domain/rules/types";
import { submitByAt } from "@/domain/timeRisk";
import type { Order } from "@/domain/types";
import { DEMO_NOW, parseDemoInstant } from "@/lib/demoClock";
import { humanizeKey } from "@/lib/labels";

export interface PaneCite {
  docId: string;
  page: number;
  quote: string;
  /** PDF page when the quote check cannot use the document page. */
  checkPage?: number;
  /** Chip text when the default page format would point at the wrong sheet. */
  label?: string;
}

const pane = (docId: string, page: number, quote: string, extra?: Pick<PaneCite, "checkPage" | "label">): PaneCite => ({
  docId,
  page,
  quote,
  ...extra,
});
const kirkNote = (quote: string) => pane("kirk-note", 1, quote);
const kirkLists = (quote: string) => pane("kirk-lists", 1, quote, { checkPage: 2 });
const kirkRad = (quote: string) => pane("kirk-rad", 1, quote, { checkPage: 2 });
const kirkPt = (quote: string) => pane("kirk-pt", 1, quote, { checkPage: 3 });
/** Scott's fax numbers the missing sheet. PDF page 4 is fax page 5. */
const scott = (pdfPage: number, quote: string) => {
  const page = [1, 2, 3, 5, 6][pdfPage - 1] ?? pdfPage;
  return pane("scott-fax", page, quote, pdfPage === page ? undefined : { checkPage: pdfPage });
};
const suluNote = (quote: string) => pane("sulu-note", 1, quote);
const policy = (page: number, quote: string): PaneCite => ({ docId: "policy", page, quote, label: "Policy" });

export interface BlockerItem {
  id: string;
  item: string;
  who: string;
  phone?: string;
  fax?: string;
  cite?: PaneCite;
  epic?: boolean;
  note?: string;
}

export type WaiverStatus = "Present" | "Denied in note" | "Not mentioned";

export interface WaiverRow {
  id: string;
  trigger: string;
  status: WaiverStatus;
  detail: string;
  cite: PaneCite | null;
  /** Packet file key, so a quote can be checked against the PDF. */
  file?: string;
}

export interface TreatmentBar {
  name: string;
  start: string;
  end: string;
  note: string;
  cite: PaneCite;
}

export interface CitedFact {
  text: string;
  cite: PaneCite;
}

export interface ClinicalFactsModel {
  /** Closed when every insurer criterion is already met. */
  open: boolean;
  summary: string;
  onset: string;
  scan: string;
  /** Policy duration, as a date on the same axis. Null when the policy has no week threshold. */
  threshold: string | null;
  thresholdLabel: string;
  treatments: TreatmentBar[];
  undated: CitedFact[];
  imaging: CitedFact[];
  exam: CitedFact[];
  redFlags: WaiverRow[];
}

export interface AttachmentCheck {
  label: string;
  met: boolean;
  cite: PaneCite | null;
}

export interface PacketModel {
  attachments: AttachmentCheck[];
  pages: string;
  channel: string;
  channelCite: PaneCite | null;
}

interface WaiverNote {
  status: WaiverStatus;
  detail: string;
  cite: PaneCite;
}

const WAIVERS: Record<string, Record<string, WaiverNote>> = {
  "case-1-kirk": {
    cauda_equina_symptoms: {
      status: "Denied in note",
      detail: "Bowel, bladder and saddle anesthesia denied",
      cite: kirkNote("Denies bowel or bladder changes, saddle numbness, fever, chills, night sweats or weight loss. No history of cancer."),
    },
    progressive_neurological_deficit: {
      status: "Denied in note",
      detail: "Strength 5/5 in both legs",
      cite: kirkNote("Strength 5/5 bilateral lower extremities"),
    },
    suspected_infection: {
      status: "Denied in note",
      detail: "Fever and chills denied",
      cite: kirkNote("Denies bowel or bladder changes, saddle numbness, fever, chills, night sweats or weight loss. No history of cancer."),
    },
    suspected_malignancy_or_cancer_history: {
      status: "Denied in note",
      detail: "No history of cancer",
      cite: kirkNote("No history of cancer."),
    },
    significant_trauma: {
      status: "Not mentioned",
      detail: "Began after lifting, not described as trauma",
      cite: kirkNote("low back pain that began ~09/14/2026"),
    },
    symptoms_materially_changed: {
      status: "Not mentioned",
      detail: "No prior lumbar MRI to compare",
      cite: kirkLists("No MRI of the lumbar spine on record."),
    },
  },
  "case-2-scott": {
    suspected_ligament_rupture_with_instability: {
      status: "Not mentioned",
      detail: "The visit does not describe instability",
      cite: scott(3, "R knee pain and clicking x 7 wks"),
    },
    locked_knee_unable_to_extend: {
      status: "Not mentioned",
      detail: "Occasional locking on stairs, not a locked knee",
      cite: scott(3, "occasional locking on stairs"),
    },
    suspected_fracture_not_seen_on_xray: {
      status: "Not mentioned",
      detail: "The X-ray impression does not raise a fracture",
      cite: scott(4, "Small effusion. Mild medial compartment narrowing."),
    },
  },
  "case-3-sulu": {
    trauma_with_weakness: {
      status: "Denied in note",
      detail: "Trauma (fencing), strength 5/5 → doesn't meet 'trauma with weakness'",
      cite: suluNote("Full ROM, 5/5 strength, pain w/ overhead reach."),
    },
    suspected_full_thickness_rotator_cuff_tear: {
      status: "Not mentioned",
      detail: "Not mentioned on the order",
      cite: suluNote("R shoulder pain x 3 wks after fencing."),
    },
    dislocation: {
      status: "Not mentioned",
      detail: "Not mentioned on the order",
      cite: suluNote("Full ROM, 5/5 strength, pain w/ overhead reach."),
    },
    suspected_infection: {
      status: "Not mentioned",
      detail: "Not mentioned on the order",
      cite: suluNote("R shoulder pain x 3 wks after fencing."),
    },
    history_of_cancer: {
      status: "Not mentioned",
      detail: "Not mentioned on the order",
      cite: suluNote("R shoulder pain x 3 wks after fencing."),
    },
  },
};

let cached: ReturnType<typeof buildSeedDb> | null = null;
function rulesDb() {
  cached ??= buildSeedDb();
  return cached;
}

function policyIdOf(ref: string | null): string {
  return ref?.split(" ")[0] ?? "";
}

export function activePolicy(ref: string | null): PolicyVersion | null {
  const externalId = policyIdOf(ref);
  if (!externalId) return null;
  const db = rulesDb();
  const found = db.policies.find((item) => item.externalPolicyId === externalId);
  if (!found) return null;
  return db.versions.find((item) => item.policyId === found.id && item.effectiveTo === null) ?? null;
}

function citeFor(record: CaseRecord, document: string): PaneCite | undefined {
  const needle = document.toLowerCase();
  const row = record.extracted.find((item) => `${item.section} ${item.label} ${item.excerpt} ${item.cite.quote}`.toLowerCase().includes(needle.split(" ")[0] ?? needle));
  return row?.cite;
}

/** One row per missing document, with the office that can send it. */
export function blockersFor(order: Order, record: CaseRecord): BlockerItem[] {
  if (order.reasonCode === "RETURN_TO_PROVIDER") {
    const provider = record.elements.find((item) => item.label === "Ordering provider");
    const contact = contactFor(provider?.value ?? String(order.detail.doctor ?? ""));
    return [
      {
        id: "provider",
        item: "Ordering provider",
        who: contact?.name ?? String(order.detail.doctor ?? "Ordering provider"),
        ...(contact?.phone ? { phone: contact.phone } : {}),
        ...(contact?.fax ? { fax: contact.fax } : {}),
        ...(provider?.cite ? { cite: provider.cite } : {}),
      },
    ];
  }
  const details = [
    ...(order.detail.document && order.detail.source ? [order.detail] : []),
    ...order.otherIssues.map((issue) => issue.detail).filter((detail) => detail.document && detail.source),
  ];
  return details.map((detail, index) => {
    const source = String(detail.source);
    const epic = /epic/i.test(source);
    const contact = epic ? null : contactFor(source);
    const cite = citeFor(record, String(detail.document));
    return {
      id: `${detail.document}-${index}`,
      item: String(detail.document),
      who: contact?.name ?? source,
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(contact?.fax ? { fax: contact.fax } : {}),
      ...(epic ? { epic: true } : {}),
      ...(cite ? { cite } : {}),
      ...(detail.line ? { note: String(detail.line) } : {}),
    };
  });
}

/**
 * The slot cannot be met when submit-by is already before the packet arrived,
 * or before now while a person still has open work.
 */
export function slotWarning(order: Order, receivedAt: string | undefined, now: Date = DEMO_NOW): string | null {
  if (!order.scheduledAt || !order.insurer) return null;
  if (order.status === "submitted" || order.status === "approved" || order.status === "denied" || order.status === "cancelled" || order.status === "not_required") {
    return null;
  }
  const submitBy = submitByAt(parseDemoInstant(order.scheduledAt), order.insurer);
  const arrived = receivedAt ? new Date(receivedAt).getTime() : null;
  const open = order.status === "needs_admin_review" || order.status === "needs_clinical_review";
  const beforeArrival = arrived != null && submitBy.getTime() < arrived;
  const beforeNow = open && submitBy.getTime() < now.getTime();
  if (!beforeArrival && !beforeNow) return null;
  const hours = medianDecisionHours(order.insurer);
  return `Scan slot can't be met at ${order.insurer}'s ~${hours}h turnaround`;
}

export function presentWaivers(order: Order): WaiverRow[] {
  const version = activePolicy(order.policyRef);
  if (!version) return [];
  const notes = WAIVERS[order.id] ?? {};
  const rows: WaiverRow[] = [];
  for (const exception of version.exceptions) {
    for (const trigger of exception.triggers) {
      const note = notes[trigger];
      rows.push({
        id: `${exception.key}:${trigger}`,
        trigger: humanizeKey(trigger),
        status: note?.status ?? "Not mentioned",
        detail: note?.detail ?? "Not mentioned in the packet",
        cite: note?.cite ?? null,
      });
    }
  }
  return rows;
}

function addDays(iso: string, days: number): string {
  const stamp = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86400000;
  return new Date(stamp).toISOString().slice(0, 10);
}

function weeksOf(version: PolicyVersion | null): number | null {
  const weeks = version?.criteria.find((item) => item.key === "symptom_duration")?.properties.find((item) => item.key === "duration" && item.unit === "weeks")?.value;
  return typeof weeks === "number" ? weeks : null;
}

const STORIES: Record<string, Omit<ClinicalFactsModel, "open" | "redFlags" | "threshold" | "thresholdLabel">> = {
  "case-1-kirk": {
    summary: "PT 12 visits · naproxen 4 wks · X-ray 10/02 · red flags denied",
    onset: "2026-09-14",
    scan: "2026-11-18",
    treatments: [
      { name: "PT", start: "2026-09-21", end: "2026-10-31", note: "12 visits · minimal relief", cite: kirkPt("12 attended, 0 missed") },
      { name: "Naproxen", start: "2026-09-28", end: "2026-10-26", note: "Partial relief, stopped for GI upset", cite: kirkNote("Took naproxen 500 mg BID x 4 weeks with partial relief, stopped 10/26") },
      { name: "HEP", start: "2026-10-31", end: "2026-11-09", note: "Continuing at discharge", cite: kirkPt("home exercise program") },
    ],
    undated: [],
    imaging: [
      { text: "XR lumbar spine 10/02", cite: kirkRad("XR LUMBAR SPINE 2-3 VIEWS, 10/02/2026 9:14 AM") },
      { text: "No lumbar MRI on record", cite: kirkLists("No MRI of the lumbar spine on record.") },
    ],
    exam: [
      { text: "Strength 5/5 both legs", cite: kirkNote("Strength 5/5 bilateral lower extremities") },
      { text: "Straight leg raise positive on the right at 40°", cite: kirkNote("Straight leg raise positive on R at 40 degrees") },
    ],
  },
  "case-2-scott": {
    summary: "PT patient-reported · X-ray 09/24",
    onset: "2026-09-22",
    scan: "2026-11-12",
    treatments: [
      { name: "PT", start: "2026-09-29", end: "2026-11-10", note: "About six weeks · patient-reported", cite: scott(3, "about six weeks") },
    ],
    undated: [{ text: "Ibuprofen PRN · some relief", cite: scott(2, "PT ~6 wks, ibuprofen") }],
    imaging: [{ text: "XR right knee 09/24", cite: scott(4, "XR KNEE RIGHT 3 VIEWS, 09/24/2026") }],
    exam: [
      { text: "Catching and occasional locking on stairs", cite: scott(3, "occasional locking on stairs") },
      { text: "Small effusion. Mild medial narrowing.", cite: scott(4, "Small effusion. Mild medial compartment narrowing.") },
    ],
  },
  "case-3-sulu": {
    summary: "PT 1 wk · no X-ray · strength 5/5",
    onset: "2026-10-20",
    scan: "2026-11-16",
    treatments: [
      { name: "PT", start: "2026-11-03", end: "2026-11-10", note: "Started last week", cite: suluNote("Started PT last wk.") },
    ],
    undated: [],
    imaging: [{ text: "No shoulder X-ray mentioned", cite: pane("sulu-order", 1, "MRI SHOULDER RIGHT WO CONTRAST [73221]") }],
    exam: [{ text: "Full ROM, strength 5/5, pain with overhead reach", cite: suluNote("Full ROM, 5/5 strength, pain w/ overhead reach.") }],
  },
};

export function clinicalFacts(order: Order, allMet: boolean): ClinicalFactsModel | null {
  const story = STORIES[order.id];
  const flags = presentWaivers(order);
  const raised = flags.filter((row) => row.status !== "Not mentioned");
  const redFlags = raised.length > 0 ? raised : flags.slice(0, 1);
  if (!story && redFlags.length === 0) return null;
  const version = activePolicy(order.policyRef);
  const weeks = weeksOf(version);
  const onset = story?.onset ?? "";
  const threshold = story && weeks ? addDays(onset, weeks * 7) : null;
  const documented = order.id === "case-2-scott" && order.faxAttached === true;
  return {
    open: !allMet,
    summary: documented ? "PT 10 visits · 39 days · X-ray 09/24" : (story?.summary ?? `${redFlags.length} waiver triggers`),
    onset,
    scan: story?.scan ?? "",
    threshold,
    thresholdLabel: weeks ? `${weeks} wk` : "",
    treatments: documented
      ? [{ name: "PT", start: "2026-09-29", end: "2026-11-06", note: "10 visits · pain 5 to 4/10", cite: pane("scott-pt", 1, "pain improved 5 to 4/10, still catching") }]
      : (story?.treatments ?? []),
    undated: story?.undated ?? [],
    imaging: story?.imaging ?? [],
    exam: story?.exam ?? [],
    redFlags,
  };
}

function attachmentMet(label: string, record: CaseRecord): { met: boolean; cite: PaneCite | null } {
  const office = /office|progress|visit/i.test(label);
  const care = /conservative|treatment|therapy/i.test(label);
  const row = record.extracted.find((item) => {
    const hay = `${item.section} ${item.label}`.toLowerCase();
    if (office) return /office|visit/.test(hay);
    if (care) return /pt|therapy/.test(hay);
    return hay.includes(label.toLowerCase());
  });
  if (!row) return { met: false, cite: null };
  return { met: true, cite: row.cite };
}

export function packetModel(order: Order, record: CaseRecord): PacketModel {
  const version = activePolicy(order.policyRef);
  const attachments = (version ? attachmentsOf(version) : []).map((label) => {
    const match = attachmentMet(label, record);
    return { label, met: match.met, cite: match.cite };
  });
  const channel = channelLine(order);
  return {
    attachments,
    pages: pagesLine(order),
    channel: channel.value,
    channelCite: channel.cite,
  };
}

export function policyFieldCite(order: Order): PaneCite | null {
  const id = policyIdOf(order.policyRef);
  if (id === "RAD-114") return policy(1, "Medical Policy RAD-114");
  if (id === "MSK-207") return policy(2, "Guideline MSK-207");
  if (id === "IMG-330") return policy(3, "IMG-330");
  return null;
}

export function activityLine(entry: { from: string; to: string; reason: string }): string {
  if (entry.from && entry.to && entry.from !== entry.to) return `${entry.from} → ${entry.to}`;
  return entry.to || entry.reason;
}

export function channelLine(order: Order): { value: string; cite: PaneCite | null } {
  const version = activePolicy(order.policyRef);
  const channels = version ? channelsOf(version) : [];
  const used = order.channel === "portal" ? "Portal" : order.channel === "api" ? "API" : order.channel === "fax" ? "Fax" : "Unknown";
  const only = channels.length === 1;
  const head = only ? `${used} only` : used;
  const deny = version ? incompleteHandlingOf(version) === "deny_resubmit_new" : false;
  const value = deny ? `${head} · Denials can't be amended` : head;
  const id = policyIdOf(order.policyRef);
  if (id === "MSK-207") return { value, cite: policy(2, "Provider web portal only") };
  if (id === "IMG-330") return { value, cite: policy(3, "Provider portal only") };
  if (id === "RAD-114") return { value, cite: policy(1, "provider API or portal") };
  return { value, cite: null };
}

function pagesLine(order: Order): string {
  if (order.id === "case-2-scott") return "Pages 1–3 and 5–6 · page 4 not received";
  const count = Math.max(order.attachmentCount, 1);
  return count === 1 ? "Page 1" : `Pages 1–${count}`;
}

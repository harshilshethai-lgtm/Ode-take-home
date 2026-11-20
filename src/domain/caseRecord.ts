// View model for the case page. Kirk is built from the answer key (verbatim quotes).
// Demo rows use the worklist order and are tagged as demo data, because they have no packet.

import kirk from "@fixtures/case-1-kirk/expected.json";
import { DEMO_NOW } from "@/data/orders";
import {
  CHEKOV_DOCUMENTS,
  KIRK_DOCUMENTS,
  SCOTT_FAX,
  SULU_DOCUMENTS,
  UHURA_DOCUMENTS,
  legacyDocument,
  scottPtDocument,
  type CaseDocument,
} from "@/domain/documents";
import { PACKETS } from "@/domain/packetCases";
import type { Order } from "@/domain/types";
import { eligibilityFor } from "@/lib/mocks/eligibility";
import { PLAN_TYPE_LABEL, RULE_LINE, label } from "@/lib/labels";
import { fmtDob, fmtTableDate } from "@/lib/format";

export type { CaseDocument };

export interface Cite {
  docId: string;
  page: number;
  quote: string;
  /** Chip text when "p.N" would be ambiguous across documents. */
  label?: string;
}

export interface CaseElement {
  label: string;
  value: string;
  cite?: Cite;
  /** External system that supplied the value. Shown as a source tag. */
  origin?: "epic" | "demo";
  /** When an Epic value was last read. */
  ranAt?: string;
  /** Low-confidence handwriting. Shown next to the value. */
  handwritten?: boolean;
  mono?: boolean;
}

export interface ExtractRow {
  section: string;
  label: string;
  excerpt: string;
  cite: Cite;
}

export interface CriterionRow {
  id: string;
  line: string;
  status: "met" | "not_met" | "unknown" | "waived";
  /** Short fact on the row. */
  fact: string;
  /** Full reason, shown on expand. */
  detail: string;
  cites: Cite[];
  policy?: Cite;
}

export interface CheckRow {
  name: string;
  result: string;
  status: "ok" | "failed" | "stale";
  ranAt: string;
}

export interface CaseRecord {
  order: Order;
  docId: string;
  /** At most 2 sentences and 40 words. */
  summary: string;
  summaryCites: Cite[];
  primaryLabel: string | null;
  elements: CaseElement[];
  flags: string[];
  extracted: ExtractRow[];
  criteria: CriterionRow[];
  policyLabel: string | null;
  policyHref: string | null;
  missing: string[];
  checks: CheckRow[];
  documents: CaseDocument[];
}

const kirkCite = (id: string, quote: string): Cite => ({ docId: id, page: 1, quote });
/** Scott citations were stored as PDF pages. The fax document numbers the missing page too. */
const SCOTT_DOC_PAGE = [1, 2, 3, 5, 6];
const scottCite = (pdfPage: number, quote: string): Cite => ({
  docId: "scott-fax",
  page: SCOTT_DOC_PAGE[pdfPage - 1] ?? pdfPage,
  quote,
});
const suluOrder = (quote: string): Cite => ({ docId: "sulu-order", page: 1, quote });
const suluNote = (quote: string): Cite => ({ docId: "sulu-note", page: 1, quote });

function policyPage(policyRef: string | null): { title: string; page: number } | null {
  if (!policyRef) return null;
  if (policyRef.startsWith("RAD-114")) return { title: "RAD-114", page: 1 };
  if (policyRef.startsWith("MSK-207")) return { title: "MSK-207", page: 2 };
  if (policyRef.startsWith("IMG-330")) return { title: "IMG-330", page: 3 };
  return null;
}

export function primaryLabelFor(order: Order): string | null {
  switch (order.reasonCode) {
    case "PORTAL_UPLOAD":
    case "SUBMISSION_FAILED":
      return "Upload";
    case "MISSING_DOCUMENTS":
    case "MORE_INFO_REQUESTED":
      return "Request records";
    case "SIDE_MISMATCH":
    case "CPT_MISMATCH":
    case "INSURER_MISMATCH":
    case "WRONG_PATIENT_PAGE":
      return "Correct";
    case "UNREADABLE_DOCUMENT":
    case "NO_MATCH":
      return "Request a clean copy";
    case "RETURN_TO_PROVIDER":
      return "Send draft";
    case "CRITERIA_NOT_MET":
    case "RULE_GAP":
    case "CONFIRM_AFTER_FIX":
    case "REPEATED_REQUESTS":
    case "DENIED_DECIDE_APPEAL":
      return "Review";
    default:
      return null;
  }
}

const FLAG_LABEL: Record<string, string> = {
  safety: "Wrong patient",
  missing_docs: "Missing pages",
  coverage: "Coverage mismatch",
  rule_violation: "Rule not met",
};

function demoRecord(order: Order): CaseRecord {
  const patient = order.patient;
  const policy = policyPage(order.policyRef);
  const eligibility = eligibilityFor(patient?.mrn);
  const plan = order.plan ?? (eligibility ? label(PLAN_TYPE_LABEL, eligibility.planType) : null);
  const insurer = order.insurer ?? eligibility?.payer ?? null;
  const scan = order.scheduledAt ? fmtTableDate(new Date(order.scheduledAt)) : null;

  const elements: CaseElement[] = [
    { label: "Patient", value: patient?.name ?? "Not found", origin: patient ? "demo" : undefined },
    {
      label: "DOB and MRN",
      value: patient ? `${fmtDob(patient.dob)} · ${patient.mrn}` : "Not found",
      origin: patient ? "demo" : undefined,
      mono: true,
    },
    {
      label: "Insurance",
      value: [insurer, plan].filter(Boolean).join(" · ") || "Not found",
      origin: insurer ? "demo" : undefined,
    },
    {
      label: "Exam",
      value: [order.study, order.cpt, order.side].filter(Boolean).join(" · "),
      origin: "demo",
    },
    { label: "Scan slot", value: scan ?? "Not found", origin: scan ? "demo" : undefined },
    { label: "Policy", value: order.policyRef ?? "Not found" },
  ];

  return {
    order,
    docId: order.orderNumber ?? "Unmatched",
    summary: order.reason,
    summaryCites: [],
    primaryLabel: primaryLabelFor(order),
    elements,
    flags: (order.findings ?? []).map((f) => FLAG_LABEL[f.type] ?? "Flag").slice(0, 2),
    extracted: [],
    criteria: [],
    policyLabel: order.policyRef,
    policyHref: policy ? "/settings" : null,
    missing: order.nextAction !== "None" ? [order.nextAction] : [],
    checks: [],
    documents: [],
  };
}

function kirkRecord(order: Order): CaseRecord {
  const eligibility = eligibilityFor(order.patient?.mrn);
  const plan = eligibility ? label(PLAN_TYPE_LABEL, eligibility.planType) : null;
  const scan = fmtTableDate(new Date(order.scheduledAt!));

  const elements: CaseElement[] = [
    { label: "Patient", value: "James T. Kirk", cite: kirkCite("kirk-order", "KIRK, JAMES T") },
    {
      label: "DOB and MRN",
      value: `${fmtDob(order.patient!.dob)} · ${order.patient!.mrn}`,
      cite: kirkCite("kirk-order", "MRN HH-0017011 · DOB 03/22/1981"),
      mono: true,
    },
    {
      label: "Insurance",
      value: `Federation Health · ${plan} · ${eligibility?.memberId}`,
      origin: "epic",
      ranAt: DEMO_NOW.toISOString(),
    },
    {
      label: "Exam",
      value: "MRI lumbar spine · 72148",
      cite: kirkCite("kirk-order", "MRI LUMBAR SPINE WO CONTRAST [72148]"),
    },
    {
      label: "Scan slot",
      value: `${scan} · Enterprise Campus MRI 2`,
      cite: kirkCite("kirk-order", "11/18/2026 2:30 PM, Enterprise Campus MRI 2"),
    },
    {
      label: "Ordering provider",
      value: "Leonard McCoy, MD · 1700000017",
      cite: kirkCite("kirk-order", "Leonard McCoy, MD (NPI 1700000017)"),
    },
    { label: "Policy", value: "RAD-114 v3" },
  ];

  const extracted: ExtractRow[] = [
    { section: "Office note", label: "Complaint", excerpt: "Low back pain radiating down R leg x 8 weeks.", cite: kirkCite("kirk-note", "Low back pain radiating down R leg x 8 weeks.") },
    { section: "Office note", label: "Onset", excerpt: "Began ~09/14/2026 after lifting.", cite: kirkCite("kirk-note", "low back pain that began ~09/14/2026") },
    { section: "Office note", label: "Therapy", excerpt: "12 visits, 9/21 to 10/31, minimal relief.", cite: kirkCite("kirk-note", "Completed 6 weeks of physical therapy at Starbase Physical Therapy (12 visits, 9/21 to 10/31)") },
    { section: "Office note", label: "Naproxen", excerpt: "500 mg BID x 4 weeks, stopped 10/26.", cite: kirkCite("kirk-note", "Took naproxen 500 mg BID x 4 weeks with partial relief, stopped 10/26") },
    { section: "Office note", label: "Red flags", excerpt: "Denies bowel, bladder, saddle, fever, cancer.", cite: kirkCite("kirk-note", "Denies bowel or bladder changes, saddle numbness, fever, chills, night sweats or weight loss. No history of cancer.") },
    { section: "Office note", label: "Strength", excerpt: "5/5 both legs.", cite: kirkCite("kirk-note", "Strength 5/5 bilateral lower extremities") },
    { section: "Med list", label: "Naproxen", excerpt: "09/28/2026 to 10/26/2026, stopped, GI upset.", cite: kirkCite("kirk-lists", "Naproxen 500 mg tab") },
    { section: "Imaging history", label: "Prior MRI", excerpt: "No MRI of the lumbar spine on record.", cite: kirkCite("kirk-lists", "No MRI of the lumbar spine on record.") },
    { section: "Radiology report", label: "X-ray", excerpt: "XR lumbar spine, 10/02/2026.", cite: kirkCite("kirk-rad", "XR LUMBAR SPINE 2-3 VIEWS, 10/02/2026 9:14 AM") },
    { section: "Radiology report", label: "Impression", excerpt: "Mild degenerative disc disease at L5-S1.", cite: kirkCite("kirk-rad", "Mild degenerative disc disease at L5-S1.") },
    { section: "PT note", label: "Dates", excerpt: "9/21/2026 to 10/31/2026.", cite: kirkCite("kirk-pt", "9/21/2026 to 10/31/2026") },
    { section: "PT note", label: "Visits", excerpt: "12 attended, 0 missed.", cite: kirkCite("kirk-pt", "12 attended, 0 missed") },
    { section: "PT note", label: "Response", excerpt: "Oswestry 44% to 40%.", cite: kirkCite("kirk-pt", "Oswestry Disability Index 44% at intake, 40% at discharge.") },
  ];

  const shortFact: Record<string, string> = {
    "2a": "8 wks, onset 9/14",
    "2b": "PT 12 visits · naproxen 4 wks",
    "2c": "X-ray 10/02",
    "2d": "No lumbar MRI on record",
  };

  const criteria: CriterionRow[] = kirk.expected.criteria.map((c) => ({
    id: c.id,
    line: label(RULE_LINE, c.id),
    status: "met" as const,
    fact: shortFact[c.id] ?? c.label,
    detail: c.proof,
    cites: c.citations.map((cite) => kirkCriterionCite(cite.page, cite.quote)),
  }));

  return {
    order,
    docId: order.orderNumber ?? kirk.order.orderNumber,
    summary: "Lumbar MRI for radiculopathy, routine. Sent to Federation Health: 8 weeks of pain and documented care meet the policy.",
    summaryCites: [kirkCite("kirk-note", "Low back pain radiating down R leg x 8 weeks."), kirkCite("kirk-pt", "Dates of care: 9/21/2026 to 10/31/2026")],
    primaryLabel: primaryLabelFor(order),
    elements,
    flags: [],
    extracted,
    criteria,
    policyLabel: "RAD-114 v3",
    policyHref: "/settings",
    missing: [],
    checks: [
      {
        name: "Eligibility",
        result: `Federation Health · ${plan} · ${eligibility?.memberId}`,
        status: "ok",
        ranAt: DEMO_NOW.toISOString(),
      },
    ],
    documents: KIRK_DOCUMENTS,
  };
}

function kirkCriterionCite(page: number, quote: string): Cite {
  if (page === 3) return kirkCite("kirk-pt", quote);
  if (page === 1) return kirkCite("kirk-note", quote);
  if (/naproxen|no mri/i.test(quote)) return kirkCite("kirk-lists", quote);
  return kirkCite("kirk-rad", quote);
}

function scottRecord(order: Order): CaseRecord {
  const packet = scottCite;
  const scanNote = "notes should come over by fax";
  const attached = order.faxAttached === true;
  const record: CaseRecord = {
    order,
    docId: order.orderNumber!,
    summary: "Right knee MRI, routine. PT notes are missing, and the six weeks of therapy is only the patient's report.",
    summaryCites: [packet(1, "p.4 PT progress notes, Utopia Planitia Rehab"), packet(3, "about six weeks")],
    primaryLabel: "Request records",
    elements: [
      { label: "Patient", value: "Montgomery Scott", cite: packet(2, "Montgomery Scott") },
      {
        label: "DOB and MRN",
        value: "06/11/1979 · HH-0017042",
        cite: packet(2, "HH-0017042"),
        mono: true,
      },
      {
        label: "Insurance",
        value: "Ferengi Benefit Group · FBG-0047-1979",
        cite: packet(2, "FBG-0047-1979"),
      },
      {
        label: "Scan slot",
        value: "Thu 11/12 · 9:00 AM",
        cite: packet(1, "Pt scheduled Thurs 11/12 9am. Please rush."),
        handwritten: true,
        origin: "epic",
        ranAt: DEMO_NOW.toISOString(),
      },
      { label: "Exam", value: "MRI R knee · 73721", cite: packet(2, "MRI R knee w/o contrast") },
      { label: "Ordering provider", value: "L. McCoy, MD", cite: packet(2, "L. McCoy") },
      { label: "Policy", value: "MSK-207 rev 3" },
    ],
    flags: ["Missing pages"],
    extracted: [
      { section: "Cover", label: "Listed", excerpt: "PT notes, Utopia Planitia Rehab, not in the fax.", cite: packet(1, "p.4 PT progress notes, Utopia Planitia Rehab") },
      { section: "Cover", label: "Slot", excerpt: "Thursday 11/12 at 9:00 AM. Handwritten.", cite: packet(1, "Pt scheduled Thurs 11/12 9am. Please rush.") },
      { section: "Note", label: "Hold the slot", excerpt: "Keep the Thursday slot.", cite: packet(5, "keep the Thursday slot") },
      { section: "Request", label: "Treatment", excerpt: "PT about 6 weeks, ibuprofen.", cite: packet(2, "PT ~6 wks, ibuprofen") },
      { section: "Office note", label: "Complaint", excerpt: "R knee pain and clicking x 7 wks.", cite: packet(3, "R knee pain and clicking x 7 wks") },
      { section: "Office note", label: "Onset", excerpt: "Twisted the right knee ~9/22.", cite: packet(3, "twisted R knee climbing a ladder at work ~9/22") },
      { section: "Office note", label: "Therapy", excerpt: "Patient reports about six weeks of PT.", cite: packet(3, "about six weeks") },
      { section: "Office note", label: "Locking", excerpt: "Catching and occasional locking on stairs.", cite: packet(3, "occasional locking on stairs") },
      { section: "X-ray", label: "Exam", excerpt: "XR right knee, 09/24/2026.", cite: packet(4, "XR KNEE RIGHT 3 VIEWS, 09/24/2026") },
      { section: "X-ray", label: "Impression", excerpt: "Small effusion. Mild medial narrowing.", cite: packet(4, "Small effusion. Mild medial compartment narrowing.") },
      { section: "Note", label: "Scheduling", excerpt: "PT notes should come over by fax.", cite: packet(5, scanNote) },
    ],
    criteria: [
      {
        id: "1",
        line: "Pain ≥ 4 wks",
        status: "met",
        fact: "7 wks, onset ~9/22",
        detail: "Office note: pain and clicking for 7 weeks, twisted climbing a ladder ~9/22.",
        cites: [packet(3, "R knee pain and clicking x 7 wks"), packet(3, "twisted R knee climbing a ladder at work ~9/22")],
      },
      {
        id: "2",
        line: "Documented care ≥ 4 wks",
        status: "unknown",
        fact: "Patient-reported only",
        detail: "The office note quotes the patient. The PT notes on the cover are not in the fax.",
        cites: [packet(3, "about six weeks"), packet(1, "p.4 PT progress notes, Utopia Planitia Rehab")],
      },
      {
        id: "3",
        line: "Knee X-ray in 6 mo",
        status: "met",
        fact: "X-ray 09/24",
        detail: "Right knee X-ray 09/24/2026, inside six months of the 11/10 order.",
        cites: [packet(4, "XR KNEE RIGHT 3 VIEWS, 09/24/2026")],
      },
      {
        id: "4",
        line: "No knee MRI in 12 mo",
        status: "unknown",
        fact: "Not in the fax",
        detail: "No page says whether this knee had an MRI in the past year.",
        cites: [],
      },
    ],
    policyLabel: "MSK-207 rev 3",
    policyHref: "/settings",
    missing: ["PT notes from Utopia Planitia", "Imaging history"],
    checks: [],
    documents: attached ? [SCOTT_FAX, scottPtDocument(order.statusSince)] : [SCOTT_FAX],
  };
  if (!attached) return record;
  const pt = (quote: string): Cite => ({ docId: "scott-pt", page: 1, quote });
  record.criteria = record.criteria.map((row) => {
    if (row.id === "2") {
      return {
        ...row,
        status: "met",
        fact: "39 days of documented PT",
        detail: "Utopia Planitia notes cover 9/29 to 11/6, 10 visits. Pain improved 5 to 4/10 and is still catching.",
        cites: [pt("09/29/2026 to 11/06/2026"), pt("pain improved 5 to 4/10, still catching")],
      };
    }
    if (row.id === "4") {
      return {
        ...row,
        status: "met",
        fact: "None on record",
        detail: "Epic imaging history lists no knee MRI in the past year.",
        cites: [],
      };
    }
    return row;
  });
  record.missing = [];
  record.flags = [];
  record.summary = "Right knee MRI, routine. Ten PT visits over 39 days are documented, and Epic has no prior knee MRI.";
  return record;
}

function suluRecord(order: Order): CaseRecord {
  const packet = (_page: number, quote: string): Cite =>
    /SULU, HIKARU|DOB 09\/14\/1984|AL-1701|MRI SHOULDER RIGHT WO|Scheduled 11\/16|McCoy, Leonard/.test(quote) ? suluOrder(quote) : suluNote(quote);
  const eligibility = eligibilityFor(order.patient?.mrn);
  return {
    order,
    docId: order.orderNumber!,
    summary: "Right shoulder MRI, routine. Three weeks of pain and one week of therapy are under the six weeks required.",
    summaryCites: [packet(1, "R shoulder pain x 3 wks after fencing."), packet(1, "Started PT last wk.")],
    primaryLabel: "Send draft",
    elements: [
      { label: "Patient", value: "Hikaru Sulu", cite: packet(1, "SULU, HIKARU") },
      {
        label: "DOB and MRN",
        value: `${fmtDob(order.patient!.dob)} · ${order.patient!.mrn}`,
        cite: packet(1, "DOB 09/14/1984"),
        mono: true,
      },
      {
        label: "Insurance",
        value: `Andorian Life · EPO · ${eligibility?.memberId}`,
        cite: packet(1, "AL-1701-0914"),
      },
      { label: "Exam", value: "MRI shoulder right · 73221", cite: packet(1, "MRI SHOULDER RIGHT WO CONTRAST [73221]") },
      {
        label: "Scan slot",
        value: fmtTableDate(new Date(order.scheduledAt!)),
        cite: packet(1, "Scheduled 11/16/2026 11:00 AM"),
      },
      { label: "Ordering provider", value: "Leonard McCoy, MD", cite: packet(1, "McCoy, Leonard, MD") },
      { label: "Policy", value: "IMG-330" },
    ],
    flags: ["Rule not met"],
    extracted: [
      { section: "Order", label: "Reason", excerpt: "R shoulder pain x 3 wks after fencing.", cite: packet(1, "R shoulder pain x 3 wks after fencing.") },
      { section: "Order", label: "Therapy", excerpt: "Started PT last week.", cite: packet(1, "Started PT last wk.") },
      { section: "Order", label: "Exam", excerpt: "Full ROM, 5/5 strength, pain overhead.", cite: packet(1, "Full ROM, 5/5 strength, pain w/ overhead reach.") },
    ],
    criteria: [
      {
        id: "1",
        line: "Pain ≥ 6 wks",
        status: "not_met",
        fact: "3 wks",
        detail: "The order says right shoulder pain for 3 weeks. The policy requires 6.",
        cites: [packet(1, "R shoulder pain x 3 wks after fencing.")],
      },
      {
        id: "2",
        line: "Documented care ≥ 6 wks",
        status: "not_met",
        fact: "PT for 1 wk",
        detail: "Therapy started last week, so it is under the 6 weeks required.",
        cites: [packet(1, "Started PT last wk.")],
      },
      {
        id: "3",
        line: "Shoulder X-ray",
        status: "unknown",
        fact: "Not on the order",
        detail: "The order does not mention a shoulder X-ray.",
        cites: [],
      },
      {
        id: "4",
        line: "No shoulder MRI in 12 mo",
        status: "unknown",
        fact: "Not on the order",
        detail: "The order does not say whether a shoulder MRI was done this year.",
        cites: [],
      },
    ],
    policyLabel: "IMG-330",
    policyHref: "/settings",
    missing: [],
    checks: [
      {
        name: "Eligibility",
        result: `Andorian Life · EPO · ${eligibility?.memberId}`,
        status: "ok",
        ranAt: DEMO_NOW.toISOString(),
      },
    ],
    documents: SULU_DOCUMENTS,
  };
}

export function buildCaseRecord(order: Order): CaseRecord {
  if (order.id === "case-1-kirk") return kirkRecord(order);
  if (order.id === "case-2-scott") return scottRecord(order);
  if (order.id === "case-3-sulu") return suluRecord(order);
  if (order.id === "case-26-uhura") return letterRecord(order, UHURA_DOCUMENTS);
  if (order.id === "case-27-chekov") return letterRecord(order, CHEKOV_DOCUMENTS);
  const packetCase = PACKETS[order.id];
  if (!packetCase) return demoRecord(order);
  return {
    order,
    docId: order.orderNumber ?? order.patient?.name ?? "Unmatched",
    summary: packetCase.summary,
    summaryCites: packetCase.summaryCites,
    primaryLabel: primaryLabelFor(order),
    elements: packetCase.elements,
    flags: packetCase.flags,
    extracted: packetCase.extracted,
    criteria: packetCase.criteria,
    policyLabel: packetCase.policyLabel,
    policyHref: packetCase.policyHref,
    missing: packetCase.missing,
    checks: [],
    documents: [
      legacyDocument(
        order.id,
        packetCase.file,
        packetCase.title,
        packetCase.extracted.map((row) => ({ section: row.section, page: row.cite.page })),
      ),
    ],
  };
}

function letterRecord(order: Order, documents: CaseDocument[]): CaseRecord {
  const base = demoRecord(order);
  const first = documents[0];
  if (order.id === "case-26-uhura" && first) {
    return {
      ...base,
      summary: "Federation Health denied the lumbar MRI under section 2b. The appeal attaches the missing PT notes and is signed.",
      summaryCites: [
        { docId: "uhura-denial", page: 1, quote: "denied under RAD-114 section 2b" },
        { docId: "uhura-appeal", page: 1, quote: "PT documentation was missing" },
      ],
      documents,
      extracted: [
        { section: "Denial", label: "Section 2b", excerpt: "Denied under section 2b. PT notes were not included.", cite: { docId: "uhura-denial", page: 1, quote: "denied under RAD-114 section 2b" } },
        { section: "Appeal", label: "Attached PT", excerpt: "The discharge is attached. Nurse and doctor signed.", cite: { docId: "uhura-appeal", page: 1, quote: "Christine Chapel, RN" } },
      ],
    };
  }
  return {
    ...base,
    summary: "Andorian Life rejected the upload because the file was over 10MB. Compress it under 10MB and resubmit.",
    summaryCites: [{ docId: "chekov-error", page: 1, quote: "upload failed: file > 10MB" }],
    documents,
    extracted: [
      {
        section: "Error",
        label: "Upload",
        excerpt: "File over 10MB. Compress the packet and resubmit.",
        cite: { docId: "chekov-error", page: 1, quote: "upload failed: file > 10MB" },
      },
    ],
  };
}

export function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function sentences(s: string): number {
  return s.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
}

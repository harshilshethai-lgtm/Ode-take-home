// Fax chase for a case that is blocked on something an outside office can send or confirm.
// Copy is written per case. A shared letter shape is not a shared clinical story.

import type { Order } from "@/domain/types";

export interface OutreachItem {
  id: string;
  /** Checkbox label. */
  label: string;
  /** Line printed on the fax when this box is checked. */
  ask: string;
}

export interface OutreachBrief {
  orderId: string;
  /** One line on the to-do bar. */
  banner: string;
  partyRole: string;
  partyName: string;
  /** Empty when the packet never gave a number. */
  fax: string;
  /** Why this office, under the number. */
  partyNote: string;
  items: OutreachItem[];
  regarding: string;
  /** What is wrong with this packet. */
  situation: string;
  /** What Halcyon will do with the reply. */
  use: string;
}

export interface FaxLetter {
  date: string;
  toName: string;
  toRole: string;
  fax: string;
  regarding: string;
  paragraphs: string[];
  asks: string[];
  signoff: string[];
}

const OPEN = new Set(["needs_admin_review", "needs_clinical_review"]);

const BRIEFS: Record<string, OutreachBrief> = {
  "case-2-scott": {
    orderId: "case-2-scott",
    banner: "MSK-207 still needs the PT notes the cover listed.",
    partyRole: "Rehab clinic",
    partyName: "Utopia Planitia Rehab",
    fax: "(210) 555-0144",
    partyNote: "Named on the cover as page 4. That page is not in the fax.",
    regarding: "Montgomery Scott · MRI right knee · 73721 · ORD-58242",
    situation:
      "Ferengi Benefit Group requires documented conservative care under MSK-207. The office note only quotes Montgomery Scott, and a patient's own report does not count. The cover lists Utopia Planitia progress notes as page 4, and that page never arrived.",
    use: "Attach the notes to ORD-58242 and re-check documented care. The right-knee X-ray from September 24 is already on file, so do not resend it.",
    items: [
      {
        id: "pt-notes",
        label: "PT progress notes",
        ask: "PT progress notes from Utopia Planitia for the visits he reports as about six weeks.",
      },
    ],
  },
  "case-3-sulu": {
    orderId: "case-3-sulu",
    banner: "IMG-330 is missing a shoulder X-ray and MRI history.",
    partyRole: "Ordering office",
    partyName: "Leonard McCoy, MD",
    fax: "(210) 555-0160",
    partyNote: "The order has no X-ray and no prior MRI. Duration is already on it.",
    regarding: "Hikaru Sulu · MRI shoulder right · 73221 · ORD-58258",
    situation:
      "Andorian Life's IMG-330 cannot be completed from this order alone. Right-shoulder pain of 3 weeks and one week of therapy are already written down, and both are short of 6 weeks. This fax is only for the two records the order never includes.",
    use: "Send the X-ray report and the imaging history. Do not resend the order. Duration and therapy are already on it.",
    items: [
      {
        id: "xray",
        label: "Shoulder X-ray",
        ask: "The shoulder X-ray, if one was done. IMG-330 requires it, and the order does not mention one.",
      },
      {
        id: "prior-mri",
        label: "Prior MRI history",
        ask: "Whether a right-shoulder MRI was done in the last 12 months.",
      },
    ],
  },
  "case-12-crusher": {
    orderId: "case-12-crusher",
    banner: "The office-visit page is blank, so pain duration is open.",
    partyRole: "Ordering office",
    partyName: "W. Crusher, MD",
    fax: "(210) 555-0172",
    partyNote: "Page 3 holds only the fax header.",
    regarding: "Beverly Crusher · MRI right knee · 73721",
    situation:
      "The office-visit page in Beverly Crusher's right-knee packet is blank, so MSK-207 cannot confirm that the pain has lasted 4 weeks. Therapy from October 1 to November 6 and the October 1 X-ray are already readable.",
    use: "Replace page 3 only. Do not resend the PT note or the X-ray.",
    items: [
      {
        id: "visit",
        label: "Office note, page 3",
        ask: "A readable copy of the office visit, page 3, with the onset of the right knee pain.",
      },
    ],
  },
  "case-13-laforge": {
    orderId: "case-13-laforge",
    banner: "Therapy, the X-ray, and the member ID cannot be read.",
    partyRole: "Fax sender",
    partyName: "Clinic that sent this fax",
    fax: "",
    partyNote: "The header did not survive. The patient name did. No number was guessed.",
    regarding: "Geordi La Forge · MRI lumbar spine",
    situation:
      "Geordi La Forge's lumbar MRI fax cannot be used as it arrived. The chief complaint looks like 4 weeks of pain, and the lines after it are smeared. Therapy, the X-ray, and the member ID were not guessed.",
    use: "Resend a clean copy of the whole packet. Eligibility cannot run until the member ID can be read.",
    items: [
      {
        id: "therapy",
        label: "Therapy line",
        ask: "Therapy dates and the visit count. That line is broken up on the visit page.",
      },
      {
        id: "xray",
        label: "X-ray report",
        ask: "The X-ray the cover lists. The report page is too degraded to quote.",
      },
      {
        id: "member",
        label: "Member ID",
        ask: "The member ID.",
      },
    ],
  },
  "case-15-nog": {
    orderId: "case-15-nog",
    banner: "Page 3 is Rom's chart. Nog's PT discharge is missing.",
    partyRole: "Ordering office",
    partyName: "Bashir-Mora, MD",
    fax: "(210) 555-0188",
    partyNote: "Page 3 was quarantined. It is Rom, born 01/11/1975, not Nog.",
    regarding: "Nog · MRI lumbar spine · born 04/02/2001",
    situation:
      "Page 3 of Nog's lumbar MRI packet is a PT discharge for Rom, born 01/11/1975, for a cervical strain. It was quarantined and will not be used. RAD-114 still needs Nog's own therapy note. His visit says he finished 6 weeks at Rio Grande. He was born 04/02/2001.",
    use: "Fax Nog's discharge only. Do not resend Rom's page. His lumbar X-ray from October 8 is already on file.",
    items: [
      {
        id: "discharge",
        label: "Nog's PT discharge",
        ask: "PT discharge for Nog, born 04/02/2001, from Rio Grande.",
      },
      {
        id: "history",
        label: "His imaging history",
        ask: "Whether Nog had a lumbar MRI in the last 12 months. His visit does not say, and Rom's page cannot be read for this.",
      },
    ],
  },
  "case-17-obrien": {
    orderId: "case-17-obrien",
    banner: "The form says left knee. The visit and X-ray say right.",
    partyRole: "Ordering office",
    partyName: "J. Bashir-Mora",
    fax: "(410) 555-0109",
    partyNote: "Three records name the right knee. The form does not.",
    regarding: "Miles O'Brien · MRI knee · 73721",
    situation:
      "Ferengi Benefit Group will not take a knee MRI while the request and the records name different sides. The form says left. The visit, the therapy note, and the September 25 X-ray say right. MSK-207 was checked against the right knee. Denied requests on this plan cannot be amended.",
    use: "Write which knee CPT 73721 should authorize. If the form is wrong, send a corrected order before we submit.",
    items: [
      {
        id: "side",
        label: "Which knee to authorize",
        ask: "Written confirmation of the knee: left, as the form says, or right, as the visit and the X-ray say.",
      },
      {
        id: "corrected",
        label: "Corrected order",
        ask: "A corrected order if the left knee on the form is the error.",
      },
    ],
  },
  "case-18-sisko": {
    orderId: "case-18-sisko",
    banner: "The order says Federation. The card scanned is Bajoran.",
    partyRole: "Ordering office",
    partyName: "Leonard McCoy, MD",
    fax: "(210) 555-0160",
    partyNote: "The visit says he switched insurance at work this month.",
    regarding: "Benjamin Sisko · MRI lumbar spine · ORD-58287",
    situation:
      "Benjamin Sisko's lumbar MRI cannot be submitted until one plan is active. The order still lists Federation Health, last verified June 2, 2025. The card scanned November 9 is Bajoran Health Plan, member BHP-4471-0315-01, effective November 1. The clinical record already meets a lumbar policy. Coverage does not.",
    use: "Confirm the plan that is active on the November 17 scan. Eligibility will be rerun before anything is sent.",
    items: [
      {
        id: "payer",
        label: "Active plan on the scan date",
        ask: "Which plan is active on November 17: Federation Health, or Bajoran Health Plan.",
      },
      {
        id: "card",
        label: "Card to bill",
        ask: "A copy of the card that should be billed, if the card scanned at check-in is the right one.",
      },
    ],
  },
  "case-20-odo": {
    orderId: "case-20-odo",
    banner: "All 4 pages are blank. Nothing was read from this fax.",
    partyRole: "Fax sender",
    partyName: "Promenade Urgent Care",
    fax: "555-0148",
    partyNote: "Taken from the fax header. The body of every page is blank.",
    regarding: "Unmatched fax · Promenade Urgent Care",
    situation:
      "This fax from Promenade Urgent Care has a header and nothing else. All 4 pages are blank. No patient, study, insurer, or order was read, and nothing was guessed.",
    use: "Resend the packet. Put the patient name, date of birth, the study, and the insurer on the first page so it can be matched.",
    items: [
      {
        id: "packet",
        label: "Readable packet",
        ask: "A readable copy of the packet this header was meant to carry.",
      },
    ],
  },
};

export function outreachFor(order: Pick<Order, "id" | "status">): OutreachBrief | null {
  if (!OPEN.has(order.status)) return null;
  return BRIEFS[order.id] ?? null;
}

export function composeFax(
  brief: OutreachBrief,
  selectedIds: readonly string[],
  other: string,
  senderName: string,
  date: string,
  again: boolean,
): FaxLetter {
  const chosen = new Set(selectedIds);
  const asks = brief.items.filter((item) => chosen.has(item.id)).map((item) => item.ask);
  const extra = other.trim();
  if (extra) asks.push(extra);
  return {
    date,
    toName: brief.partyName,
    toRole: brief.partyRole,
    fax: brief.fax,
    regarding: brief.regarding,
    paragraphs: [
      ...(again ? ["This is a follow-up. The earlier fax did not add these records."] : []),
      brief.situation,
      brief.use,
    ],
    asks,
    signoff: ["Halcyon prior auth", senderName],
  };
}

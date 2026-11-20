// A case is a bundle of documents. Citations point at a document and a page inside it.

export type SourceKind = "epic" | "inbound_fax" | "portal_upload" | "insurer_letter" | "eligibility";

export type SourceGroup = "Epic" | "Inbound faxes" | "Insurer" | "Policy";

export interface DocumentSection {
  label: string;
  /** Inclusive pages inside this document, not the original combined file. */
  pageRange: [number, number];
}

export interface CaseDocument {
  id: string;
  caseId: string;
  title: string;
  /** Chip prefix: "Starbase PT · p.1". */
  shortName: string;
  sourceKind: SourceKind;
  sender: string;
  /** America/New_York wall time, no zone. */
  receivedAt: string;
  /** Pages actually on file. */
  pages: number;
  sections: DocumentSection[];
  /** What the sender claimed, when that is larger than `pages`. */
  declaredPageTotal?: number;
  /** Pages inside this document that never arrived. */
  missingPages?: number[];
  /** Cover-sheet description of a missing page. */
  missingDetail?: string;
  /** Key into the packet URL map. */
  file: string;
  /** PDF page in `file` that is this document's page 1, when pages are contiguous. */
  filePageStart: number;
  /** Document page → PDF page. Null means the page is missing. Overrides filePageStart. */
  pdfPageByDocPage?: Array<number | null>;
  initialPage: number;
  /** Combined file offered as a download, when this document is a slice of it. */
  originalFile?: string;
}

export const SOURCE_GROUPS: SourceGroup[] = ["Epic", "Inbound faxes", "Insurer", "Policy"];
const GROUP_ORDER = SOURCE_GROUPS;

export interface DocumentSlot {
  docPage: number;
  faxPage: number | null;
  pdfPage: number | null;
  missing?: { detail: string; declared: number };
}

/** One viewer slot per page of this document, including a page the fax never included. */
export function documentSlots(doc: CaseDocument, _pdfCount = 0): DocumentSlot[] {
  const fax = doc.sourceKind === "inbound_fax";
  const mapped = doc.pdfPageByDocPage ?? Array.from({ length: Math.max(doc.pages, 1) }, (_, index) => pdfPageFor(doc, index + 1));
  return mapped.map((pdfPage, index) => {
    const docPage = index + 1;
    return {
      docPage,
      faxPage: fax ? docPage : null,
      pdfPage,
      ...(pdfPage == null
        ? { missing: { detail: doc.missingDetail ?? "page", declared: doc.declaredPageTotal ?? mapped.length } }
        : {}),
    };
  });
}

export function sourceGroup(kind: SourceKind): Exclude<SourceGroup, "Policy"> {
  if (kind === "inbound_fax") return "Inbound faxes";
  if (kind === "insurer_letter" || kind === "portal_upload") return "Insurer";
  return "Epic";
}

export function groupOrder(): SourceGroup[] {
  return GROUP_ORDER;
}

export function pdfPageFor(doc: CaseDocument, page: number): number | null {
  if (doc.pdfPageByDocPage) {
    const value = doc.pdfPageByDocPage[page - 1];
    return value === undefined ? null : value;
  }
  if (doc.missingPages?.includes(page)) return null;
  return doc.filePageStart + page - 1;
}

export function chipLabel(doc: Pick<CaseDocument, "shortName">, page: number): string {
  return `${doc.shortName} · p.${page}`;
}

export function pageCountLabel(doc: Pick<CaseDocument, "pages" | "declaredPageTotal">): string {
  if (doc.declaredPageTotal && doc.declaredPageTotal !== doc.pages) return `${doc.pages} of ${doc.declaredPageTotal} pages`;
  return doc.pages === 1 ? "1 page" : `${doc.pages} pages`;
}

export function sectionMissing(doc: CaseDocument, section: DocumentSection): boolean {
  const [start, end] = section.pageRange;
  return doc.missingPages?.some((page) => page >= start && page <= end) ?? false;
}

export function sectionButton(doc: CaseDocument, section: DocumentSection): string {
  const [start, end] = section.pageRange;
  const range = start === end ? `p.${start}` : `p.${start}–${end}`;
  return sectionMissing(doc, section) ? `[missing] ${section.label} ${range}` : `${section.label} ${range}`;
}

function doc(partial: CaseDocument): CaseDocument {
  return partial;
}

export const KIRK_DOCS: CaseDocument[] = [
  doc({
    id: "kirk-order",
    caseId: "case-1-kirk",
    title: "Imaging order",
    shortName: "Epic order",
    sourceKind: "epic",
    sender: "Epic",
    receivedAt: "2026-11-09T10:12:00",
    pages: 1,
    sections: [{ label: "Order", pageRange: [1, 1] }],
    file: "kirk",
    filePageStart: 1,
    initialPage: 1,
    originalFile: "kirk",
  }),
  doc({
    id: "kirk-note",
    caseId: "case-1-kirk",
    title: "Office note 11/09",
    shortName: "Epic note",
    sourceKind: "epic",
    sender: "Leonard McCoy, MD",
    receivedAt: "2026-11-09T10:12:00",
    pages: 1,
    sections: [{ label: "Office note", pageRange: [1, 1] }],
    file: "kirk",
    filePageStart: 1,
    initialPage: 1,
  }),
  doc({
    id: "kirk-lists",
    caseId: "case-1-kirk",
    title: "Medications, problems, imaging history",
    shortName: "Epic lists",
    sourceKind: "epic",
    sender: "Epic",
    receivedAt: "2026-11-09T10:12:00",
    pages: 1,
    sections: [
      { label: "Medications", pageRange: [1, 1] },
      { label: "Problems", pageRange: [1, 1] },
      { label: "Imaging history", pageRange: [1, 1] },
    ],
    file: "kirk",
    filePageStart: 2,
    initialPage: 1,
  }),
  doc({
    id: "kirk-rad",
    caseId: "case-1-kirk",
    title: "XR lumbar spine 10/02",
    shortName: "Epic imaging",
    sourceKind: "epic",
    sender: "Radiology",
    receivedAt: "2026-10-02T09:14:00",
    pages: 1,
    sections: [{ label: "Radiology report", pageRange: [1, 1] }],
    file: "kirk",
    filePageStart: 2,
    initialPage: 1,
  }),
  doc({
    id: "kirk-pt",
    caseId: "case-1-kirk",
    title: "Starbase PT discharge",
    shortName: "Starbase PT",
    sourceKind: "inbound_fax",
    sender: "Starbase Physical Therapy",
    receivedAt: "2026-11-02T11:04:00",
    pages: 1,
    sections: [{ label: "Discharge", pageRange: [1, 1] }],
    file: "kirk",
    filePageStart: 3,
    initialPage: 1,
  }),
];

export const SCOTT_FAX: CaseDocument = doc({
  id: "scott-fax",
  caseId: "case-2-scott",
  title: "Fax",
  shortName: "Clinic fax",
  sourceKind: "inbound_fax",
  sender: "Enterprise Clinic",
  receivedAt: "2026-11-10T08:52:00",
  pages: 5,
  declaredPageTotal: 6,
  missingPages: [4],
  missingDetail: "PT progress notes, Utopia Planitia Rehab",
  pdfPageByDocPage: [1, 2, 3, null, 4, 5],
  sections: [
    { label: "Cover", pageRange: [1, 1] },
    { label: "Request form", pageRange: [2, 2] },
    { label: "Office note", pageRange: [3, 3] },
    { label: "PT notes", pageRange: [4, 4] },
    { label: "X-ray", pageRange: [5, 5] },
    { label: "Note", pageRange: [6, 6] },
  ],
  file: "scott",
  filePageStart: 1,
  initialPage: 1,
});

export const SCOTT_PT: CaseDocument = doc({
  id: "scott-pt",
  caseId: "case-2-scott",
  title: "Utopia Planitia Rehab · PT progress notes",
  shortName: "Utopia PT",
  sourceKind: "inbound_fax",
  sender: "Utopia Planitia Rehab",
  receivedAt: "2026-11-10T14:00:00",
  pages: 2,
  sections: [{ label: "Progress notes", pageRange: [1, 2] }],
  file: "scott-pt",
  filePageStart: 1,
  initialPage: 1,
});

export const SULU_DOCS: CaseDocument[] = [
  doc({
    id: "sulu-order",
    caseId: "case-3-sulu",
    title: "Order",
    shortName: "Epic order",
    sourceKind: "epic",
    sender: "Epic",
    receivedAt: "2026-11-10T13:05:00",
    pages: 1,
    sections: [{ label: "Order", pageRange: [1, 1] }],
    file: "sulu",
    filePageStart: 1,
    initialPage: 1,
  }),
  doc({
    id: "sulu-note",
    caseId: "case-3-sulu",
    title: "Office visit 11/10",
    shortName: "Epic note",
    sourceKind: "epic",
    sender: "Leonard McCoy, MD",
    receivedAt: "2026-11-10T13:05:00",
    pages: 1,
    sections: [{ label: "Exam", pageRange: [1, 1] }],
    file: "sulu-note",
    filePageStart: 1,
    initialPage: 1,
  }),
];

export const UHURA_DOCS: CaseDocument[] = [
  doc({
    id: "uhura-denial",
    caseId: "case-26-uhura",
    title: "Denial letter",
    shortName: "Denial",
    sourceKind: "insurer_letter",
    sender: "Federation Health",
    receivedAt: "2026-11-09T16:10:00",
    pages: 1,
    sections: [{ label: "Denial", pageRange: [1, 1] }],
    file: "uhura-denial",
    filePageStart: 1,
    initialPage: 1,
  }),
  doc({
    id: "uhura-pt",
    caseId: "case-26-uhura",
    title: "Starbase PT discharge",
    shortName: "Starbase PT",
    sourceKind: "inbound_fax",
    sender: "Starbase Physical Therapy",
    receivedAt: "2026-11-08T15:20:00",
    pages: 1,
    sections: [{ label: "Discharge", pageRange: [1, 1] }],
    file: "uhura-pt",
    filePageStart: 1,
    initialPage: 1,
  }),
  doc({
    id: "uhura-appeal",
    caseId: "case-26-uhura",
    title: "Appeal packet",
    shortName: "Appeal",
    sourceKind: "portal_upload",
    sender: "Halcyon Health",
    receivedAt: "2026-11-10T11:15:00",
    pages: 1,
    sections: [{ label: "Appeal", pageRange: [1, 1] }],
    file: "uhura-appeal",
    filePageStart: 1,
    initialPage: 1,
  }),
];

export const CHEKOV_DOCS: CaseDocument[] = [
  doc({
    id: "chekov-error",
    caseId: "case-27-chekov",
    title: "Portal receipt",
    shortName: "Portal",
    sourceKind: "portal_upload",
    sender: "Andorian Life",
    receivedAt: "2026-11-10T11:40:00",
    pages: 1,
    sections: [{ label: "Receipt", pageRange: [1, 1] }],
    file: "chekov-portal",
    filePageStart: 1,
    initialPage: 1,
  }),
];

export function scottDocuments(attached: boolean): CaseDocument[] {
  return attached ? [SCOTT_FAX, SCOTT_PT] : [SCOTT_FAX];
}

/** When the case arrived: the earliest document on file. */
export function caseReceivedAt(order: { id: string; faxAttached?: boolean }): string | null {
  const docs = caseDocuments(order);
  if (!docs || docs.length === 0) return null;
  return docs.reduce((earliest, doc) => (doc.receivedAt < earliest ? doc.receivedAt : earliest), docs[0].receivedAt);
}

export function caseDocuments(order: { id: string; faxAttached?: boolean }): CaseDocument[] | null {
  if (order.id === "case-1-kirk") return KIRK_DOCS;
  if (order.id === "case-2-scott") return scottDocuments(order.faxAttached === true);
  if (order.id === "case-3-sulu") return SULU_DOCS;
  if (order.id === "case-26-uhura") return UHURA_DOCS;
  if (order.id === "case-27-chekov") return CHEKOV_DOCS;
  return null;
}

export const KIRK_DOCUMENTS = KIRK_DOCS;
export const SULU_DOCUMENTS = SULU_DOCS;
export const UHURA_DOCUMENTS = UHURA_DOCS;
export const CHEKOV_DOCUMENTS = CHEKOV_DOCS;

export function scottPtDocument(receivedAt?: string): CaseDocument {
  if (!receivedAt || /z$/i.test(receivedAt)) return SCOTT_PT;
  return { ...SCOTT_PT, receivedAt };
}

export function legacyDocument(
  caseId: string,
  file: string,
  title: string,
  rows: Array<{ section: string; page: number }>,
): CaseDocument {
  return packetDocument(caseId, {
    file,
    title,
    extracted: rows.map((row) => ({ section: row.section, cite: { page: row.page } })),
    elements: [],
  });
}

export function packetDocument(
  caseId: string,
  packet: {
    file: string;
    title: string;
    extracted: Array<{ section: string; cite: { page: number } }>;
    elements: Array<{ cite?: { page: number } }>;
  },
): CaseDocument {
  const cited = [
    ...packet.extracted.map((row) => row.cite.page),
    ...packet.elements.map((row) => row.cite?.page ?? 0),
  ];
  const pages = Math.max(1, ...cited);
  const fax = /fax/i.test(packet.title);
  const groups: Array<{ label: string; start: number; end: number }> = [];
  for (const row of packet.extracted) {
    const last = groups.at(-1);
    if (last && last.label === row.section) {
      last.start = Math.min(last.start, row.cite.page);
      last.end = Math.max(last.end, row.cite.page);
    } else groups.push({ label: row.section, start: row.cite.page, end: row.cite.page });
  }
  return {
    id: "packet",
    caseId,
    title: packet.title,
    shortName: fax ? "Fax" : "Epic note",
    sourceKind: fax ? "inbound_fax" : "epic",
    sender: fax ? "Outside clinic" : "Epic",
    receivedAt: "2026-11-09T15:00:00",
    pages,
    sections: groups.length
      ? groups.map((group) => ({ label: group.label, pageRange: [group.start, group.end] }))
      : [{ label: packet.title, pageRange: [1, pages] }],
    file: packet.file,
    filePageStart: 1,
    initialPage: 1,
  };
}

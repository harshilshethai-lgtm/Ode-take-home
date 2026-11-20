// How the case viewer numbers pages. Citations store the PDF page that holds the quote.
// A fax header (P.001/006) can disagree with that when a declared page never arrived.

import type { ExtractRow } from "@/domain/caseRecord";

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageSlot {
  faxPage: number | null;
  pdfPage: number | null;
  missing?: { detail: string; declared: number };
}

export interface ViewerSection {
  id: string;
  label: string;
  start: number;
  end: number;
  pdfPage: number | null;
  faxPage: number | null;
  missing?: boolean;
}

export interface PolicyAttachment {
  id: "policy";
  title: string;
  source: string;
  page: number;
}

export type ZoomMode = "width" | "page" | "custom";

export interface ZoomChoice {
  mode: ZoomMode;
  scale: number;
}

const POLICY_PDF = "fixtures/policies/insurer-policy-excerpts.pdf";

const POLICY_PAGE: Record<string, number> = {
  "RAD-114": 1,
  "MSK-207": 2,
  "IMG-330": 3,
};

/** Scott's cover lists 6 pages. The PT notes (fax page 4) are not in the file, so later PDF pages shift. */
const SCOTT_PDF_TO_FAX = [1, 2, 3, 5, 6];

const SCOTT_SECTIONS: ViewerSection[] = [
  { id: "cover", label: "Cover", start: 1, end: 1, pdfPage: 1, faxPage: 1 },
  { id: "request", label: "Request form", start: 2, end: 2, pdfPage: 2, faxPage: 2 },
  { id: "office", label: "Office note", start: 3, end: 3, pdfPage: 3, faxPage: 3 },
  { id: "pt", label: "PT notes", start: 4, end: 4, pdfPage: null, faxPage: 4, missing: true },
  { id: "xray", label: "X-ray", start: 5, end: 5, pdfPage: 4, faxPage: 5 },
  { id: "note", label: "Note", start: 6, end: 6, pdfPage: 5, faxPage: 6 },
];

const SCOTT_GAP = "PT progress notes, Utopia Planitia Rehab";

/** Normalized boxes for scanned pages, keyed by a short quote that appears in the citation. */
const SCAN_BOXES: Record<string, { page: number; quote: string; box: NormBox }[]> = {
  scott: [
    { page: 1, quote: "PT progress notes", box: { x: 0.12, y: 0.468, w: 0.34, h: 0.016 } },
    { page: 1, quote: "Pt scheduled Thurs", box: { x: 0.11, y: 0.562, w: 0.61, h: 0.03 } },
    { page: 2, quote: "Montgomery Scott", box: { x: 0.28, y: 0.12, w: 0.22, h: 0.024 } },
    { page: 2, quote: "HH-0017042", box: { x: 0.28, y: 0.196, w: 0.17, h: 0.024 } },
    { page: 2, quote: "Ferengi Benefit Group", box: { x: 0.28, y: 0.234, w: 0.26, h: 0.024 } },
    { page: 2, quote: "FBG-0047-1979", box: { x: 0.28, y: 0.272, w: 0.2, h: 0.024 } },
    { page: 2, quote: "MRI R knee", box: { x: 0.28, y: 0.31, w: 0.3, h: 0.024 } },
    { page: 2, quote: "L. McCoy", box: { x: 0.28, y: 0.464, w: 0.12, h: 0.024 } },
    { page: 2, quote: "PT ~6 wks", box: { x: 0.32, y: 0.58, w: 0.22, h: 0.02 } },
    { page: 3, quote: "R knee pain and clicking x 7 wks", box: { x: 0.13, y: 0.11, w: 0.22, h: 0.016 } },
    { page: 3, quote: "x 7 wks", box: { x: 0.27, y: 0.11, w: 0.08, h: 0.016 } },
    { page: 3, quote: "twisted R knee", box: { x: 0.17, y: 0.13, w: 0.33, h: 0.018 } },
    { page: 3, quote: "occasional locking", box: { x: 0.55, y: 0.13, w: 0.22, h: 0.018 } },
    { page: 3, quote: "about six weeks", box: { x: 0.1, y: 0.148, w: 0.18, h: 0.018 } },
    { page: 4, quote: "XR KNEE RIGHT", box: { x: 0.095, y: 0.112, w: 0.32, h: 0.016 } },
    { page: 4, quote: "Small effusion", box: { x: 0.096, y: 0.172, w: 0.65, h: 0.018 } },
    { page: 5, quote: "notes should come over by fax", box: { x: 0.17, y: 0.248, w: 0.32, h: 0.07 } },
    { page: 5, quote: "keep the Thursday slot", box: { x: 0.17, y: 0.328, w: 0.33, h: 0.026 } },
  ],
};

const ZOOM_KEY = "halcyon.viewer.zoom.v1";

export function isFax(file: string | undefined, title: string | undefined): boolean {
  return file === "scott" || title === "Fax";
}

export function faxPageForPdf(file: string | undefined, pdfPage: number): number {
  if (file === "scott") return SCOTT_PDF_TO_FAX[pdfPage - 1] ?? pdfPage;
  return pdfPage;
}

export function pdfPageForFax(file: string | undefined, faxPage: number): number | null {
  if (file !== "scott") return faxPage;
  const index = SCOTT_PDF_TO_FAX.indexOf(faxPage);
  return index >= 0 ? index + 1 : null;
}

export function citeLabel(file: string | undefined, title: string | undefined, pdfPage: number): string {
  if (!isFax(file, title)) return `p.${pdfPage}`;
  return `fax p.${faxPageForPdf(file, pdfPage)}`;
}

export function pageSlots(file: string | undefined, title: string | undefined, pdfCount: number): PageSlot[] {
  if (file === "scott") {
    return Array.from({ length: 6 }, (_, index) => {
      const faxPage = index + 1;
      const pdfPage = pdfPageForFax(file, faxPage);
      return {
        faxPage,
        pdfPage,
        ...(pdfPage == null ? { missing: { detail: SCOTT_GAP, declared: 6 } } : {}),
      };
    });
  }
  const count = Math.max(pdfCount, 1);
  const fax = isFax(file, title);
  return Array.from({ length: count }, (_, index) => ({
    faxPage: fax ? index + 1 : null,
    pdfPage: pdfCount > 0 ? index + 1 : index === 0 ? 1 : null,
  }));
}

export function declaredPages(file: string | undefined, pdfCount: number): number {
  if (file === "scott") return 6;
  return pdfCount;
}

export function pageLabel(slot: PageSlot, declared: number, pdfCount: number): string {
  const total = declared || "–";
  if (slot.faxPage != null && slot.pdfPage != null) return `PDF p.${slot.pdfPage} · fax p.${slot.faxPage} of ${total}`;
  if (slot.faxPage != null) return `fax p.${slot.faxPage} of ${total}`;
  const shown = slot.pdfPage ?? 1;
  return `${shown} of ${pdfCount || "–"}`;
}

export function slotForTarget(
  slots: PageSlot[],
  target: { page?: number; faxPage?: number } | null,
): number {
  if (target?.faxPage != null) {
    const byFax = slots.findIndex((slot) => slot.faxPage === target.faxPage);
    if (byFax >= 0) return byFax;
  }
  if (target?.page) {
    const byPdf = slots.findIndex((slot) => slot.pdfPage === target.page && !slot.missing);
    if (byPdf >= 0) return byPdf;
  }
  return 0;
}

export function viewerSections(file: string, title: string, extracted: Pick<ExtractRow, "section" | "cite">[]): ViewerSection[] {
  if (file === "scott") return SCOTT_SECTIONS;
  const groups: ViewerSection[] = [];
  for (const row of extracted) {
    const page = row.cite.page;
    const last = groups.at(-1);
    if (last && last.label === row.section) {
      last.start = Math.min(last.start, page);
      last.end = Math.max(last.end, page);
      continue;
    }
    groups.push({
      id: `${groups.length}-${row.section}-${page}`,
      label: row.section,
      start: page,
      end: page,
      pdfPage: page,
      faxPage: title === "Fax" ? page : null,
    });
  }
  return groups;
}

export function sectionText(section: ViewerSection): string {
  const range = section.start === section.end ? `p.${section.start}` : `p.${section.start}–${section.end}`;
  return section.missing ? `[missing] ${section.label} ${range}` : `${section.label} ${range}`;
}

export function missingCopy(slot: PageSlot): string | null {
  if (!slot.missing || slot.faxPage == null) return null;
  return `Fax page ${slot.faxPage} of ${slot.missing.declared} not received · ${slot.missing.detail} (per cover sheet)`;
}

export function policyAttachment(policyRef: string | null | undefined, sourceDocument: string | null | undefined): PolicyAttachment | null {
  const parsed = parseSource(sourceDocument);
  const title = policyRef?.split(" ")[0] || parsed?.title || "";
  const page = parsed?.page ?? (title ? POLICY_PAGE[title] : undefined);
  if (!page) return null;
  return {
    id: "policy",
    title: title || "Policy",
    source: parsed?.path ?? POLICY_PDF,
    page,
  };
}

function parseSource(doc: string | null | undefined): { path: string; page: number; title: string } | null {
  if (!doc) return null;
  const [path, hash] = doc.split("#");
  const page = Number(/page=(\d+)/.exec(hash ?? "")?.[1] ?? "");
  if (!path || !page) return null;
  return { path, page, title: "" };
}

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** A box from the scan map, or a stable band on the page when the quote was never measured. */
export function boxForQuote(file: string | undefined, pdfPage: number, quote: string): NormBox {
  const known = (file ? SCAN_BOXES[file] : undefined) ?? [];
  const needle = compact(quote);
  const hits = known.filter((entry) => {
    if (entry.page !== pdfPage) return false;
    const hay = compact(entry.quote);
    return needle.includes(hay) || hay.includes(needle);
  });
  hits.sort((a, b) => b.quote.length - a.quote.length);
  if (hits[0]) return hits[0].box;
  const spread = [...quote].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return { x: 0.1, y: 0.16 + (spread % 5) * 0.06, w: 0.72, h: 0.045 };
}

export function readZoom(): ZoomChoice {
  try {
    const raw = sessionStorage.getItem(ZOOM_KEY);
    if (!raw) return { mode: "width", scale: 1 };
    const parsed = JSON.parse(raw) as Partial<ZoomChoice>;
    if (parsed.mode === "width" || parsed.mode === "page") return { mode: parsed.mode, scale: 1 };
    if (parsed.mode === "custom" && typeof parsed.scale === "number" && parsed.scale > 0) {
      return { mode: "custom", scale: parsed.scale };
    }
    return { mode: "width", scale: 1 };
  } catch {
    return { mode: "width", scale: 1 };
  }
}

export function writeZoom(choice: ZoomChoice): void {
  try {
    sessionStorage.setItem(ZOOM_KEY, JSON.stringify(choice));
  } catch {
    /* private mode */
  }
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const next = Math.round((current + direction * 0.2) * 10) / 10;
  return Math.min(3, Math.max(0.5, next));
}

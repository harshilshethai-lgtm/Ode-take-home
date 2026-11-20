import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import type { ExtractRow } from "@/domain/caseRecord";
import {
  SOURCE_GROUPS,
  documentSlots,
  pageCountLabel,
  pdfPageFor,
  sourceGroup,
  type CaseDocument,
  type SourceGroup,
} from "@/domain/documents";
import { parseDemoInstant } from "@/lib/demoClock";
import { fmtTableDate } from "@/lib/format";
import { sourceDocumentUrl } from "@/lib/sourceDocs";
import { cn } from "@/lib/cn";
import {
  boxForQuote,
  missingCopy,
  pageLabel,
  pageSlots,
  readZoom,
  sectionText,
  slotForTarget,
  stepZoom,
  writeZoom,
  type NormBox,
  type PageSlot,
  type PolicyAttachment,
  type ViewerSection,
  type ZoomChoice,
} from "./packetView";

export interface OpenCite {
  docId: string;
  page: number;
  quote?: string;
  /** Fax page, including a page that has no PDF image. */
  faxPage?: number;
}

interface Props {
  documents: CaseDocument[];
  extracted: Pick<ExtractRow, "section" | "cite">[];
  policy: PolicyAttachment | null;
  urls: Record<CaseDocument["file"], string>;
  target: OpenCite | null;
  onTarget: (next: OpenCite) => void;
}

function canPaint(): boolean {
  try {
    return !!document.createElement("canvas").getContext("2d");
  } catch {
    return false;
  }
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/** Right pane: one PDF at a time, page controls, and a box around the open citation. */
export function DocumentPane({ documents, policy, urls, target, onTarget }: Props) {
  const packet = documents[0];
  const showingPolicy = target?.docId === "policy" && !!policy;
  const active = showingPolicy ? null : (documents.find((doc) => doc.id === target?.docId) ?? packet);
  const policyUrl = policy ? (sourceDocumentUrl(policy.source)?.split("#")[0] ?? null) : null;
  const url = showingPolicy ? policyUrl : active ? urls[active.file] : null;
  const sections = active ? sectionsOf(active) : [];
  const [pdfCount, setPdfCount] = useState(0);
  const [choice, setChoice] = useState<ZoomChoice>(readZoom);
  const fitRef = useRef({ width: 1, page: 1 });

  useEffect(() => {
    writeZoom(choice);
  }, [choice]);

  useEffect(() => {
    setPdfCount(0);
  }, [url]);

  if (!packet || !url) {
    return <div className="flex h-full items-center justify-center text-body text-fg-2">No packet on this row</div>;
  }

  const file = showingPolicy ? undefined : active?.file;
  const slots = showingPolicy || !active ? pageSlots(undefined, undefined, pdfCount) : documentSlots(active, pdfCount);
  const declared = active?.declaredPageTotal ?? slots.length;
  const index = slotForTarget(slots, showingPolicy ? { page: target?.page } : target);
  const slot = slots[index] ?? slots[0];
  const quote = slot?.missing ? undefined : target?.quote;
  const original = documents.find((doc) => doc.originalFile)?.originalFile;

  const choose = (next: ZoomChoice) => setChoice(next);
  const zoomBy = (direction: 1 | -1) => {
    const base = choice.mode === "custom" ? choice.scale : choice.mode === "page" ? fitRef.current.page : fitRef.current.width;
    choose({ mode: "custom", scale: stepZoom(base, direction) });
  };
  const goSlot = (nextIndex: number) => {
    const next = slots[nextIndex];
    if (!next) return;
    if (showingPolicy && policy) {
      onTarget({ docId: "policy", page: next.pdfPage ?? policy.page });
      return;
    }
    if (!active) return;
    onTarget({
      docId: active.id,
      page: next.docPage ?? next.pdfPage ?? 0,
      ...(next.faxPage != null ? { faxPage: next.faxPage } : {}),
    });
  };
  const openSection = (section: ViewerSection) => {
    if (!active) return;
    onTarget({
      docId: active.id,
      page: section.start,
      ...(section.faxPage != null ? { faxPage: section.faxPage } : {}),
    });
  };
  const openPolicy = () => {
    if (!policy) return;
    onTarget({ docId: "policy", page: policy.page });
  };

  const currentPage = slot?.docPage ?? slot?.faxPage ?? slot?.pdfPage ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-panel px-2 py-2">
        <span className="shrink-0 text-body text-fg">{showingPolicy ? "Policy" : active?.title}</span>
        <Attachments documents={documents} policy={policy} urls={urls} original={original} activeId={showingPolicy ? "policy" : active?.id} onOpen={onTarget} onPolicy={openPolicy} />
        {sections.map((section) => {
          const selected = !showingPolicy && currentPage != null && currentPage >= section.start && currentPage <= section.end;
          return (
            <span key={section.id} className="flex shrink-0 items-center gap-2">
              <span className="text-caption text-fg-3" aria-hidden="true">·</span>
              <button
                type="button"
                className={cn("shrink-0 text-caption", selected ? "font-medium text-fg" : section.missing ? "text-fg-3" : "text-fg-2 hover:text-fg")}
                aria-current={selected ? "page" : undefined}
                onClick={() => openSection(section)}
              >
                {sectionText(section)}
              </button>
            </span>
          );
        })}
      </div>
      <ViewerBody
        url={url}
        file={file}
        page={slot?.pdfPage ?? null}
        quote={quote}
        label={slot ? slotLabel(slot, active, declared, pdfCount, showingPolicy) : ""}
        missing={slot ? missingCopy(slot) : null}
        canPrev={index > 0}
        canNext={index < slots.length - 1}
        onPrev={() => goSlot(index - 1)}
        onNext={() => goSlot(index + 1)}
        choice={choice}
        onChoice={choose}
        onZoom={zoomBy}
        fitRef={fitRef}
        onCount={setPdfCount}
      />
    </div>
  );
}

function sectionsOf(doc: CaseDocument): ViewerSection[] {
  return doc.sections.map((section) => {
    const [start, end] = section.pageRange;
    const missing = doc.missingPages?.some((page) => page >= start && page <= end) ?? false;
    return {
      id: `${doc.id}-${section.label}`,
      label: section.label,
      start,
      end,
      pdfPage: missing ? null : pdfPageFor(doc, start),
      faxPage: doc.sourceKind === "inbound_fax" ? start : null,
      ...(missing ? { missing: true } : {}),
    };
  });
}

function slotLabel(slot: PageSlot, doc: CaseDocument | null, declared: number, pdfCount: number, policy: boolean): string {
  if (policy || !doc || slot.docPage == null) return pageLabel(slot, declared, pdfCount);
  if (slot.faxPage != null && slot.pdfPage != null && doc.declaredPageTotal) return `PDF p.${slot.pdfPage} · fax p.${slot.faxPage} of ${doc.declaredPageTotal}`;
  if (slot.faxPage != null && slot.missing) return `fax p.${slot.faxPage} of ${doc.declaredPageTotal ?? declared}`;
  return `${slot.docPage} of ${doc.pages}`;
}

function Attachments({
  documents,
  policy,
  urls,
  original,
  activeId,
  onOpen,
  onPolicy,
}: {
  documents: CaseDocument[];
  policy: PolicyAttachment | null;
  urls: Record<string, string>;
  original?: string;
  activeId?: string;
  onOpen: (cite: OpenCite) => void;
  onPolicy: () => void;
}) {
  const groups = new Map<SourceGroup, CaseDocument[]>();
  for (const doc of documents) {
    const key = sourceGroup(doc.sourceKind);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 items-center rounded-md px-2 text-caption text-fg-2 hover:bg-hover hover:text-fg">
          Attachments
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-2">
        {SOURCE_GROUPS.map((group) => {
          const docs = group === "Policy" ? [] : (groups.get(group) ?? []);
          if (docs.length === 0 && !(group === "Policy" && policy)) return null;
          return (
            <div key={group} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-caption text-fg-3">{group}</div>
              {docs.map((doc) => (
                <div key={doc.id} className={cn("rounded-md px-2 py-1", activeId === doc.id && "bg-hover")}>
                  <button type="button" className="block w-full text-left" onClick={() => onOpen({ docId: doc.id, page: doc.initialPage })}>
                    <span className="block text-body text-fg">{doc.title}</span>
                    <span className="block text-caption text-fg-2">
                      {doc.sender} · {fmtTableDate(parseDemoInstant(doc.receivedAt))} · {pageCountLabel(doc)}
                    </span>
                  </button>
                  {sectionsOf(doc).map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className="mt-1 block text-left text-caption text-fg-3 hover:text-fg"
                      onClick={() => onOpen({ docId: doc.id, page: section.start, ...(section.faxPage != null ? { faxPage: section.faxPage } : {}) })}
                    >
                      {sectionText(section)}
                    </button>
                  ))}
                </div>
              ))}
              {group === "Policy" && policy && (
                <button type="button" className="block w-full rounded-md px-2 py-1 text-left hover:bg-hover" onClick={onPolicy}>
                  <span className="block text-body text-fg">{policy.title}</span>
                  <span className="block text-caption text-fg-2">Policy · {policy.page === 1 ? "1 page" : `page ${policy.page}`}</span>
                </button>
              )}
            </div>
          );
        })}
        {original && urls[original] && (
          <a href={urls[original]} className="mt-1 block px-2 py-1 text-caption text-accent-fg" download>
            Original file
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ViewerBody({
  url,
  file,
  page,
  quote,
  label,
  missing,
  canPrev,
  canNext,
  onPrev,
  onNext,
  choice,
  onChoice,
  onZoom,
  fitRef,
  onCount,
}: {
  url: string;
  file?: string;
  page: number | null;
  quote?: string;
  label: string;
  missing: string | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  choice: ZoomChoice;
  onChoice: (next: ZoomChoice) => void;
  onZoom: (direction: 1 | -1) => void;
  fitRef: { current: { width: number; page: number } };
  onCount: (count: number) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (event.key === "[") {
        event.preventDefault();
        if (canPrev) onPrev();
      } else if (event.key === "]") {
        event.preventDefault();
        if (canNext) onNext();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        onZoom(1);
      } else if (event.key === "-" || event.key === "_" || event.key === "−") {
        event.preventDefault();
        onZoom(-1);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        onChoice({ mode: "width", scale: 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, canPrev, onChoice, onNext, onPrev, onZoom]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto px-2">
        <Button variant="ghost" aria-label="Previous page" disabled={!canPrev} onClick={onPrev}>
          <ChevronLeft size={16} />
        </Button>
        <span className="tabular px-1 text-caption text-fg-2">{label}</span>
        <Button variant="ghost" aria-label="Next page" disabled={!canNext} onClick={onNext}>
          <ChevronRight size={16} />
        </Button>
        <span className="ml-auto flex items-center">
          <Tip content="Fit width" shortcut="F">
            <Button variant="ghost" aria-label="Fit width" aria-pressed={choice.mode === "width"} onClick={() => onChoice({ mode: "width", scale: 1 })}>
              Fit width
            </Button>
          </Tip>
          <Tip content="Fit page">
            <Button variant="ghost" aria-label="Fit page" aria-pressed={choice.mode === "page"} onClick={() => onChoice({ mode: "page", scale: 1 })}>
              Fit page
            </Button>
          </Tip>
          <Tip content="Zoom out" shortcut="−">
            <Button variant="ghost" aria-label="Zoom out" onClick={() => onZoom(-1)}>
              <Minus size={16} />
            </Button>
          </Tip>
          <Tip content="Zoom in" shortcut="+">
            <Button variant="ghost" aria-label="Zoom in" onClick={() => onZoom(1)}>
              <Plus size={16} />
            </Button>
          </Tip>
        </span>
      </div>
      {missing ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-xl flex-col items-start gap-4 rounded-lg border border-line bg-chip px-4 py-4">
            <div className="text-body text-fg">{missing}</div>
            <Button
              variant="secondary"
              onClick={() => document.querySelector<HTMLButtonElement>('[data-case-action="resend_request"]')?.click()}
            >
              Request resend
            </Button>
          </div>
        </div>
      ) : (
        <PdfPage url={url} file={file} page={page ?? 1} quote={quote} choice={choice} fitRef={fitRef} onCount={onCount} />
      )}
    </div>
  );
}

interface CiteBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function PdfPage({
  url,
  file,
  page,
  quote,
  choice,
  fitRef,
  onCount,
}: {
  url: string;
  file?: string;
  page: number;
  quote?: string;
  choice: ZoomChoice;
  fitRef: { current: { width: number; page: number } };
  onCount: (count: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [box, setBox] = useState<CiteBox | null>(null);
  const [pulse, setPulse] = useState(false);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const docRef = useRef<{ url: string; doc: PDFDocumentProxy } | null>(null);

  useEffect(() => {
    const host = scroller.current;
    if (!host) return;
    const measure = () => setFrame({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!box) return;
    setPulse(true);
    boxRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    const timer = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(timer);
  }, [box]);

  useEffect(() => {
    if (!canPaint()) return;
    const canvas = canvasRef.current;
    const textLayerEl = textRef.current;
    const host = scroller.current;
    if (!canvas || !textLayerEl || !host || frame.w === 0) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let layer: { cancel: () => void } | null = null;

    (async () => {
      try {
        setError(null);
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        }
        let doc = docRef.current?.url === url ? docRef.current.doc : null;
        if (!doc) {
          const loaded = await pdfjs.getDocument({ url }).promise;
          if (cancelled) return;
          docRef.current = { url, doc: loaded };
          doc = loaded;
        }
        onCount(doc.numPages);
        const safePage = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(safePage);
        if (cancelled) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const pad = 8;
        const fitWidth = Math.max(0.25, (host.clientWidth - pad) / base.width);
        const fitPage = Math.max(0.25, Math.min(fitWidth, (host.clientHeight - pad) / base.height));
        fitRef.current = { width: fitWidth, page: fitPage };
        const scale = choice.mode === "width" ? fitWidth : choice.mode === "page" ? fitPage : choice.scale;
        const viewport = pdfPage.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        const output = pdfPage.getViewport({ scale: scale * dpr });

        canvas.width = output.width;
        canvas.height = output.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerEl.style.width = `${viewport.width}px`;
        textLayerEl.style.height = `${viewport.height}px`;
        textLayerEl.replaceChildren();

        const task = pdfPage.render({ canvas, viewport: output });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: textLayerEl, viewport });
        layer = textLayer;
        await textLayer.render();
        if (cancelled) return;
        const runs = glyphRuns(textContent.items);
        const spans = [...textLayerEl.querySelectorAll("span")];
        const fromText = quote ? locateQuote(runs, spans.length === runs.length ? spans : [], viewport, quote) : null;
        const next = fromText ?? (quote ? scaleBox(boxForQuote(file, safePage, quote), viewport.width, viewport.height) : null);
        setBox(next);
        setCallout(quote ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read this PDF");
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      layer?.cancel();
      setBox(null);
    };
  }, [url, file, page, quote, choice, frame.w, frame.h, fitRef, onCount]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-1">
      {error && <div className="mb-2 text-body text-fg-2">{error}</div>}
      {callout && <div className="mb-2 line-clamp-3 rounded-md bg-yellow-100 px-2 py-1 text-caption text-fg dark:bg-yellow-950">{callout}</div>}
      <div className="relative mx-auto w-fit bg-panel">
        <canvas ref={canvasRef} />
        <div ref={textRef} className="textLayer" />
        {box && (
          <div
            ref={boxRef}
            data-cite-box
            aria-hidden
            className={pulse ? "cite-box pulse" : "cite-box"}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        )}
      </div>
    </div>
  );
}

function scaleBox(box: NormBox, width: number, height: number): CiteBox {
  return { left: box.x * width, top: box.y * height, width: box.w * width, height: box.h * height };
}

/** A PDF text run. Coordinates are in page space, origin at the bottom left. */
interface GlyphRun {
  str: string;
  transform: ArrayLike<number>;
  width: number;
  height: number;
}

interface ViewportPoint {
  convertToViewportPoint(x: number, y: number): number[];
}

const CITE_PAD = 1;

function glyphRuns(items: readonly unknown[]): GlyphRun[] {
  const runs: GlyphRun[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof rec.str !== "string" || rec.str === "" || !isNumberList(rec.transform) || typeof rec.width !== "number") continue;
    runs.push({
      str: rec.str,
      transform: rec.transform,
      width: rec.width,
      height: typeof rec.height === "number" ? rec.height : 0,
    });
  }
  return runs;
}

function isNumberList(value: unknown): value is ArrayLike<number> {
  return !!value && typeof value === "object" && typeof (value as ArrayLike<number>).length === "number";
}

/**
 * Box around the quoted glyphs, in CSS pixels of the page viewport.
 * The text layer's own boxes are taller than the printed type, so the rect comes from the PDF run.
 * A run that only partly matches uses the text-layer fraction so proportional widths stay put.
 */
function locateQuote(runs: GlyphRun[], spans: HTMLElement[], viewport: ViewportPoint, quote: string): CiteBox | null {
  const needle = quote.toLowerCase().replace(/\s+/g, "");
  if (!needle) return null;

  const pieces: { run: number; orig: number }[] = [];
  let acc = "";
  runs.forEach((run, index) => {
    for (let i = 0; i < run.str.length; i++) {
      if (/\s/.test(run.str[i])) continue;
      acc += run.str[i].toLowerCase();
      pieces.push({ run: index, orig: i });
    }
  });
  const at = acc.indexOf(needle);
  if (at < 0) return null;

  const slices = new Map<number, { start: number; end: number }>();
  for (let i = at; i < at + needle.length; i++) {
    const { run, orig } = pieces[i];
    const cur = slices.get(run);
    if (!cur) slices.set(run, { start: orig, end: orig + 1 });
    else {
      cur.start = Math.min(cur.start, orig);
      cur.end = Math.max(cur.end, orig + 1);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [index, slice] of slices) {
    const run = runs[index];
    const [startFrac, endFrac] = runFractions(spans[index], run.str, slice.start, slice.end);
    const x = run.transform[4];
    const y = run.transform[5];
    const h = run.height || Math.hypot(run.transform[2] ?? 0, run.transform[3] ?? 0) || 8;
    const rect = viewportBox(viewport, x + run.width * startFrac, y - h * 0.25, x + run.width * endFrac, y + h * 0.9);
    minX = Math.min(minX, rect.left);
    minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.left + rect.width);
    maxY = Math.max(maxY, rect.top + rect.height);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  return {
    left: Math.max(0, minX - CITE_PAD),
    top: Math.max(0, minY - CITE_PAD),
    width: maxX - minX + CITE_PAD * 2,
    height: maxY - minY + CITE_PAD * 2,
  };
}

/** Share of a run's width that the matched characters occupy. */
function runFractions(span: HTMLElement | undefined, text: string, start: number, end: number): [number, number] {
  const fallback = (): [number, number] => {
    const n = text.length || 1;
    return [start / n, Math.max(end, start + 1) / n];
  };
  const node = span?.firstChild;
  if (!span || !(node instanceof Text)) return fallback();
  const host = span.getBoundingClientRect();
  if (host.width === 0) return fallback();
  const range = document.createRange();
  range.setStart(node, Math.min(start, node.data.length));
  range.setEnd(node, Math.min(end, node.data.length));
  const rect = range.getBoundingClientRect();
  const startFrac = (rect.left - host.left) / host.width;
  const endFrac = (rect.right - host.left) / host.width;
  if (!(endFrac > startFrac)) return fallback();
  return [Math.min(1, Math.max(0, startFrac)), Math.min(1, Math.max(0, endFrac))];
}

function viewportBox(viewport: ViewportPoint, x0: number, y0: number, x1: number, y1: number): CiteBox {
  const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
  const [bx, by] = viewport.convertToViewportPoint(x1, y1);
  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  return { left, top, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CaseDocument } from "@/domain/caseRecord";

export interface OpenCite {
  docId: string;
  page: number;
  quote?: string;
}

interface Props {
  documents: CaseDocument[];
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

/** Right pane: one PDF at a time, page controls, and a box around the open citation. */
export function DocumentPane({ documents, urls, target, onTarget }: Props) {
  const active = documents.find((d) => d.id === target?.docId) ?? documents[0];
  const page = target?.page ?? active?.initialPage ?? 1;
  const quote = target?.quote;
  const index = active ? documents.findIndex((d) => d.id === active.id) : -1;

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-body text-fg-2">No packet on this row</div>
    );
  }

  const go = (doc: CaseDocument, nextPage: number, nextQuote?: string) =>
    onTarget({ docId: doc.id, page: nextPage, quote: nextQuote });

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <Button
          variant="ghost"
          aria-label="Previous file"
          disabled={index <= 0}
          onClick={() => go(documents[index - 1], documents[index - 1].initialPage)}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          aria-label="Next file"
          disabled={index >= documents.length - 1}
          onClick={() => go(documents[index + 1], documents[index + 1].initialPage)}
        >
          <ChevronRight size={16} />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="min-w-0 flex-1 justify-start truncate">
              <span className="tabular text-fg-2">{index + 1} of {documents.length}</span>
              <span className="truncate text-fg">{active.title}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            {documents.map((d, i) => (
              <MenuItem key={d.id} selected={d.id === active.id} onClick={() => go(d, d.initialPage)}>
                <span className="tabular text-fg-3">{i + 1}</span>
                {d.title}
              </MenuItem>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <PdfPage url={urls[active.file]} page={page} quote={quote} onPage={(n) => go(active, n)} />
    </div>
  );
}

interface CiteBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function PdfPage({ url, page, quote, onPage }: { url: string; page: number; quote?: string; onPage: (n: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [box, setBox] = useState<CiteBox | null>(null);
  const [pulse, setPulse] = useState(false);
  const docRef = useRef<{ url: string; doc: PDFDocumentProxy } | null>(null);

  useEffect(() => {
    if (!box) return;
    setPulse(true);
    boxRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    const t = setTimeout(() => setPulse(false), 500);
    return () => clearTimeout(t);
  }, [box]);

  useEffect(() => {
    if (!canPaint()) return;
    const canvas = canvasRef.current;
    const textLayerEl = textRef.current;
    const host = scroller.current;
    if (!canvas || !textLayerEl || !host) return;

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
        const count = doc.numPages;
        setPageCount(count);
        const safePage = Math.min(Math.max(page, 1), count);
        const pdfPage = await doc.getPage(safePage);
        if (cancelled) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.max(0.5, (host.clientWidth - 32) / base.width);
        const scale = fit * zoom;
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
        const next = quote ? locateQuote(runs, spans.length === runs.length ? spans : [], viewport, quote) : null;
        setBox(next);
        setCallout(quote && !next ? quote : null);
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
  }, [url, page, quote, zoom]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <Button variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={16} />
        </Button>
        <span className="tabular px-1 text-caption text-fg-2">
          {page} of {pageCount || "–"}
        </span>
        <Button variant="ghost" aria-label="Next page" disabled={pageCount > 0 && page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight size={16} />
        </Button>
        <span className="ml-auto flex items-center">
          <Button variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}>
            <Minus size={16} />
          </Button>
          <span className="tabular w-10 text-center text-caption text-fg-2">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))}>
            <Plus size={16} />
          </Button>
        </span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-4">
        {error && <div className="text-body text-fg-2">{error}</div>}
        {callout && (
          <div className="mb-2 rounded-md bg-yellow-100 px-2 py-1 text-caption text-fg dark:bg-yellow-950">{callout}</div>
        )}
        <div ref={pageRef} className="relative mx-auto w-fit bg-panel">
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
    </div>
  );
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

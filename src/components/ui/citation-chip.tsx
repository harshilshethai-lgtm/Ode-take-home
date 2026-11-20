import { createContext, useContext, type ReactNode } from "react";
import { chipLabel, pdfPageFor, type CaseDocument } from "@/domain/documents";
import { cn } from "@/lib/cn";
import { Tip } from "./tooltip";

/** Case page supplies this so a fax chip reads "fax p.5" instead of the PDF index. */
const CiteFormatContext = createContext<((page: number) => string) | null>(null);
const DocumentsContext = createContext<CaseDocument[] | null>(null);

export function CiteFormatProvider({ format, children }: { format: (page: number) => string; children: ReactNode }) {
  return <CiteFormatContext.Provider value={format}>{children}</CiteFormatContext.Provider>;
}

export function DocumentsProvider({ documents, children }: { documents: CaseDocument[]; children: ReactNode }) {
  return <DocumentsContext.Provider value={documents}>{children}</DocumentsContext.Provider>;
}

interface Props {
  /** 1-based page inside the document. */
  page: number;
  /** Document this page belongs to. The chip then names that file. */
  docId?: string;
  /** Verbatim excerpt, shown on hover. */
  excerpt?: string;
  /** Replaces the default "p.N" text, e.g. "Policy" when the page number would be ambiguous. */
  label?: string;
  onOpen?: () => void;
  className?: string;
}

/** "Epic note · p.1": opens that file at the page. Every value from a PDF carries one. */
export function CitationChip({ page, docId, excerpt, label, onOpen, className }: Props) {
  const format = useContext(CiteFormatContext);
  const documents = useContext(DocumentsContext);
  const policy = label === "Policy";
  const doc = !policy && docId ? documents?.find((item) => item.id === docId) : undefined;
  const pdfPage = doc ? (pdfPageFor(doc, page) ?? page) : page;
  const file = policy ? "policy" : doc?.file;
  const text = label ?? (doc ? chipLabel(doc, page) : format ? format(page) : `p.${page}`);
  return (
    <Tip content={excerpt ? `“${excerpt}”` : `Open page ${page}`}>
      <button
        type="button"
        onClick={onOpen}
        data-chip
        data-page={pdfPage}
        data-doc-page={page}
        {...(file ? { "data-file": file } : {})}
        data-quote={excerpt}
        className={cn(
          "inline-flex h-5 items-center rounded-md bg-chip px-1 text-caption text-chip-fg tabular hover:text-accent-fg",
          className,
        )}
      >
        {text}
      </button>
    </Tip>
  );
}

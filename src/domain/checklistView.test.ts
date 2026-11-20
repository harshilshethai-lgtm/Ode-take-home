import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SEED_ORDERS } from "@/data/orders";
import { buildCaseRecord, sentences, words } from "@/domain/caseRecord";
import { getReviewPanel } from "@/domain/review/panel";
import { explainReason, whatToDo } from "@/domain/priorAuth/reasons";
import {
  composeAiSummary,
  displayedQuotes,
  presentChecklist,
  presentEvidenceCard,
  type QuoteCheck,
} from "./checklistView";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;
const model = (id: string) => presentChecklist(order(id), getReviewPanel(id, "coordinator", order(id)));

describe("checklist", () => {
  it("Scott: conservative care is not met and fixable, prior MRI is missing info", () => {
    const view = model("case-2-scott");
    expect(view.verdict).toBe("Insurer criteria: 2 of 4 met · 1 not met · 1 missing info");
    expect(view.policyLabel).toBe("MSK-207 · Rev. 3 (v1)");
    const care = view.criteria?.rows.find((row) => row.id === "conservative_care");
    expect(care?.status).toBe("not_met");
    expect(care?.tag).toBe("Fixable with records");
    expect(care?.fact).toBe("Patient-reported only · 0 of 28 days documented");
    expect(care?.fix).toBe("Get PT notes from Utopia Planitia Rehab");
    const mri = view.criteria?.rows.find((row) => row.id === "no_recent_mri");
    expect(mri?.status).toBe("unknown");
    expect(mri?.fact).toBe("Not found in the packet");
    expect(mri?.evidence.every((line) => line.cite == null)).toBe(true);
    expect(view.dataChecks?.count).toBe("5/5 passed");
    expect(view.dataChecks?.rows).toHaveLength(5);
  });

  it("Sulu: insurer criteria are 3 not met and 1 missing info, data checks stay separate", () => {
    const view = model("case-3-sulu");
    expect(view.verdict).toBe("Insurer criteria: 0 of 4 met · 3 not met · 1 missing info");
    expect(view.policyLabel).toBe("IMG-330 (v1)");
    expect(view.criteria?.rows.filter((row) => row.status === "not_met")).toHaveLength(3);
    expect(view.criteria?.rows.filter((row) => row.status === "unknown")).toHaveLength(1);
    const xray = view.criteria?.rows.find((row) => row.id === "prior_xray");
    expect(xray?.status).toBe("not_met");
    expect(xray?.tag).toBe("Fixable with records");
    expect(xray?.fact).toBe("Not found in the packet");
    expect(xray?.evidence.some((line) => line.cite?.quote)).toBe(false);
    expect(view.criteria?.rows.find((row) => row.id === "symptom_duration")?.tag).toBe("Clinical");
    expect(view.dataChecks?.count).toBe("5/5 passed");
    expect(view.dataChecks?.rows.every((row) => row.id.startsWith("CV-") || row.id.startsWith("CO-"))).toBe(true);
  });

  it("Kirk: four met rows, with the computed day count", () => {
    const view = model("case-1-kirk");
    expect(view.verdict).toBe("Insurer criteria: 4 of 4 met");
    expect(view.criteria?.defaultOpen).toBe(false);
    expect(view.criteria?.rows.map((row) => row.status)).toEqual(["met", "met", "met", "met"]);
    const care = view.criteria?.rows.find((row) => row.id === "conservative_care");
    expect(care?.fact).toBe("PT 9/21–10/31 + HEP to 11/9 = 49 days (need 42)");
    expect(care?.close).toBe(true);
    expect(view.policyLabel).toBe("RAD-114 · Effective 01/01/2026 (v3)");
  });

  it("drops a repeated next step from the summary", () => {
    const sulu = order("case-3-sulu");
    const text = composeAiSummary(explainReason(sulu.reasonCode!, sulu.detail), whatToDo(sulu.reasonCode!, sulu.detail));
    expect(text).toBe("3 weeks of pain and 1 week of PT are short of 6 weeks. Ask Dr McCoy to order an X-ray, continue PT, re-order at 6 weeks, and release the 11/16 slot.");
    expect(words(text)).toBeLessThanOrEqual(40);
    expect(sentences(text)).toBeLessThanOrEqual(2);
    expect(text).not.toMatch(/chase/i);
  });
});

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function packetPath(file: string): string | null {
  const folder = readdirSync("fixtures").find((name) => name.startsWith("case-") && name.endsWith(`-${file}`));
  return folder ? `fixtures/${folder}/input.pdf` : null;
}

async function pageText(file: string, page: number): Promise<string | null> {
  const path = file === "policy" ? "fixtures/policies/insurer-policy-excerpts.pdf" : packetPath(file);
  if (!path) return null;
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, disableWorker: true } as Parameters<typeof getDocument>[0]).promise;
  if (page < 1 || page > doc.numPages) return "";
  const content = await doc.getPage(page).then((item) => item.getTextContent());
  const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  return text.trim() ? text : null;
}

function transcript(file: string, page: number): string {
  const matches = SEED_ORDERS.filter((item) => buildCaseRecord(item).documents[0]?.file === file);
  const quotes: string[] = [];
  for (const item of matches) {
    const record = buildCaseRecord(item);
    for (const row of record.extracted) if (row.cite.page === page) quotes.push(row.cite.quote);
    for (const row of record.criteria) for (const cite of row.cites) if (cite.page === page) quotes.push(cite.quote);
    for (const element of record.elements) if (element.cite?.page === page && element.cite.quote) quotes.push(element.cite.quote);
  }
  return quotes.join(" ");
}

describe("displayed quotes", () => {
  it("every displayed quote appears on the cited page", async () => {
    const quotes: Array<QuoteCheck & { id: string }> = [];
    for (const item of SEED_ORDERS) {
      const panel = getReviewPanel(item.id, "coordinator", item);
      const view = presentChecklist(item, panel);
      for (const quote of displayedQuotes(view, presentEvidenceCard(item, panel))) quotes.push({ ...quote, id: item.id });
    }
    expect(quotes.length).toBeGreaterThan(0);
    const misses: string[] = [];
    for (const quote of quotes) {
      const text = await pageText(quote.file, quote.page);
      const haystack = norm(text ?? transcript(quote.file, quote.page));
      if (!haystack.includes(norm(quote.quote))) misses.push(`${quote.id} ${quote.file} p.${quote.page} “${quote.quote}”`);
    }
    expect(misses).toEqual([]);
  });
});

import type { Page } from "playwright";
import { norm, ocrCitedPage, textOfCitedPage, visit } from "./support";

export interface QuoteMiss {
  caseId: string;
  label: string;
  page: number | null;
  quote: string;
  source: string;
}

/** Every citation quote on a case page has to appear in that page's text layer, or in OCR when the page is a scan. */
export async function citationMisses(page: Page): Promise<QuoteMiss[]> {
  await visit(page, "/?tab=all");
  await page.getByLabel("Rows per page").selectOption("50");
  const hrefs = await page.locator("a[href^='/case/']").evaluateAll((links) => [
    ...new Set(links.map((link) => link.getAttribute("href") ?? "").filter(Boolean)),
  ]);
  const misses: QuoteMiss[] = [];
  for (const href of hrefs) {
    await visit(page, href);
    if (await page.getByRole("heading", { name: "Case not found" }).count()) continue;
    await expandDisclosures(page);
    const file = href.replace(/^\/case\/case-\d+-/, "");
    const chips = await page.locator("button[data-chip]").evaluateAll((els) =>
      els.map((el) => ({
        label: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        page: Number(el.getAttribute("data-page")),
        quote: el.getAttribute("data-quote") ?? "",
        file: el.getAttribute("data-file") ?? "",
      })),
    );
    for (const chip of chips) {
      if (!chip.quote) continue;
      const citedFile = chip.file || (chip.label === "Policy" ? "policy" : file);
      if (!Number.isFinite(chip.page) || chip.page < 1) {
        misses.push({ caseId: href, label: chip.label, page: null, quote: chip.quote, source: "no page on the chip" });
        continue;
      }
      await check(misses, href, chip.label, chip.page, chip.quote, citedFile);
    }
  }
  return misses;
}

async function check(misses: QuoteMiss[], caseId: string, label: string, pdfPage: number, quote: string, file: string): Promise<void> {
  try {
    const extracted = await textOfCitedPage(file, pdfPage);
    if (norm(extracted.text).includes(norm(quote))) return;
    if (extracted.source === "extracted" && norm(ocrCitedPage(file, pdfPage)).includes(norm(quote))) return;
    misses.push({ caseId, label, page: pdfPage, quote, source: extracted.source === "extracted" ? "ocr" : extracted.source });
  } catch (error) {
    const source = error instanceof Error ? error.message : String(error);
    misses.push({ caseId, label, page: pdfPage, quote, source });
  }
}

async function expandDisclosures(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const closed = page.locator("button[aria-expanded='false']");
    if ((await closed.count()) === 0) return;
    await closed.first().click();
  }
}


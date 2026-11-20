import type { Page } from "playwright";
import { citedPdfPage, norm, textOfCitedPage, visit } from "./support";

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
    const chips = await collectChips(page);
    for (const chip of chips) {
      if (chip.label === "Policy") {
        await chip.click(page);
        const label = await viewerLabel(page);
        const pdfPage = Number(/^(\d+)/.exec(label)?.[1] ?? "0");
        await check(misses, href, "Policy", pdfPage, chip.quote, "policy");
        continue;
      }
      const pdfPage = citedPdfPage(file, chip.label);
      if (pdfPage == null) {
        misses.push({ caseId: href, label: chip.label, page: null, quote: chip.quote, source: "no page in the packet" });
        continue;
      }
      await check(misses, href, chip.label, pdfPage, chip.quote, file);
    }
  }
  return misses;
}

async function check(misses: QuoteMiss[], caseId: string, label: string, pdfPage: number, quote: string, file: string): Promise<void> {
  const { text, source } = await textOfCitedPage(file, pdfPage);
  if (!norm(text).includes(norm(quote))) {
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

async function collectChips(page: Page): Promise<Array<{ label: string; quote: string; click: (page: Page) => Promise<void> }>> {
  const buttons = page.getByRole("button").filter({ hasText: /^(fax )?p\.\d+$|^Policy$/ });
  const count = await buttons.count();
  const chips: Array<{ label: string; quote: string; index: number }> = [];
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const label = ((await button.innerText()) ?? "").trim();
    await button.hover();
    const tip = page.getByRole("tooltip");
    await tip.waitFor({ state: "visible", timeout: 1_500 }).catch(() => {});
    const tipText = (await tip.textContent().catch(() => "")) ?? "";
    const quote = /“([^”]+)”/.exec(tipText)?.[1] ?? "";
    await page.mouse.move(0, 0);
    if (quote) chips.push({ label, quote, index: i });
  }
  return chips.map((chip) => ({
    label: chip.label,
    quote: chip.quote,
    click: async (current) => {
      await current.getByRole("button").filter({ hasText: /^(fax )?p\.\d+$|^Policy$/ }).nth(chip.index).click();
    },
  }));
}

async function viewerLabel(page: Page): Promise<string> {
  const label = page.locator("span.tabular").filter({ hasText: /^\d+ of / }).first();
  await label.waitFor({ state: "visible", timeout: 8_000 });
  return ((await label.innerText()) ?? "").trim();
}

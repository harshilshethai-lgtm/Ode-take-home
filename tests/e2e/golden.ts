import { expect } from "vitest";
import type { Locator, Page } from "playwright";
import { buildImpactModel } from "@/domain/impact/compute";
import { DEFAULT_ASSUMPTIONS } from "@/data/impact/metrics";
import { WEEKS } from "@/data/impact/weeks";
import { bothWays, visit } from "./support";

const PARTITION = ["Coordinator", "Nurse", "Return to provider", "In flight", "With insurer", "Closed"] as const;

async function see(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
}

export async function assertKirk(page: Page): Promise<void> {
  await bothWays(page, "/case/case-1-kirk", async () => {
    await see(page.getByRole("heading", { name: "James T. Kirk" }));
    await see(page.getByText("Submitted", { exact: true }).first());
    await see(page.getByText("Insurer criteria: 4 of 4 met"));
    await openSection(page, "Insurer criteria");
    expect(await page.getByText("Met", { exact: true }).count()).toBe(4);
    await see(page.getByText("FH-1701-1981"));
    await see(page.getByText("[epic]", { exact: true }).first());
    const results = await timelineResults(page);
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results).size, results.join(" | ")).toBe(results.length);
    expect(results.filter((result) => result === "Received")).toHaveLength(1);
  });
}

export async function assertScott(page: Page): Promise<void> {
  await bothWays(page, "/case/case-2-scott", async () => {
    await see(page.getByRole("heading", { name: "Montgomery Scott" }));
    await see(page.getByText("Chase records", { exact: true }).first());
    await see(page.getByText("Thu 11/12 · 9:00 AM").first());
    await see(page.locator(".text-warning").first());
    await see(page.getByText("Submission blocked until records arrive."));
    expect(await page.getByRole("button", { name: /submit/i }).count()).toBe(0);
    await openSection(page, "Insurer criteria");
    const care = page.locator("div").filter({ hasText: "Conservative care" }).filter({ hasText: "Not met" }).first();
    await see(care);
    expect(await care.innerText()).toContain("Fixable with records");
    const criterion = page.getByRole("button", { name: /Conservative care/ });
    if ((await criterion.getAttribute("aria-expanded")) === "false") await criterion.click();
    await page.getByRole("button", { name: "[missing] PT notes p.4" }).click();
    await see(page.getByText("Fax page 4 of 6 not received · PT progress notes, Utopia Planitia Rehab (per cover sheet)"));
    const cited = page.locator("button[data-quote='about six weeks']").first();
    await see(cited);
    await cited.click();
    await see(page.locator("[data-cite-box]"));
    await see(page.locator("div.line-clamp-3"));
    expect(await page.locator("div.line-clamp-3").innerText()).toContain("about six weeks");
    await see(page.getByText("PDF p.3 · fax p.3 of 6"));
  });
}

export async function assertSulu(page: Page): Promise<void> {
  await bothWays(page, "/case/case-3-sulu", async () => {
    await see(page.getByRole("heading", { name: "Hikaru Sulu" }));
    await see(page.getByText("Return to provider", { exact: true }).first());
    expect(await page.locator("[data-ai-summary]").innerText()).toContain(
      "Ask Dr McCoy to order an X-ray, continue PT, re-order at 6 weeks, and release the 11/16 slot",
    );
    await see(page.getByRole("button", { name: "Send draft" }));
    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).not.toContain("chase");
  });
}

export async function assertWorklist(page: Page): Promise<void> {
  await bothWays(page, "/?tab=with_insurer&q=Kirk&insurer=Federation+Health", async () => {
    await page.getByRole("button", { name: "Reset demo data" }).click();
    expect(await page.getByRole("tab", { name: /With insurer/ }).getAttribute("aria-selected")).toBe("true");
    expect(await page.getByLabel("Search by name, birthdate").inputValue()).toBe("Kirk");
    expect(searchParam(page, "insurer")).toBe("Federation Health");
  });

  await visit(page, "/?tab=all");
  await page.getByLabel("Rows per page").selectOption("50");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  const counts = await tabCounts(page);
  const sum = PARTITION.reduce((total, name) => total + (counts.get(name) ?? 0), 0);
  expect(sum).toBe(counts.get("All"));
  expect(counts.get("All") ?? 0).toBeGreaterThan(0);

  const seen = new Map<string, string>();
  let rowTotal = 0;
  for (const name of PARTITION) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}(?:\\s|\\d|$)`) });
    await tab.click();
    await page.waitForFunction((label) => {
      const found = [...document.querySelectorAll("[role='tab']")].find((el) =>
        new RegExp(`^${label}(?:\\s|\\d|$)`).test((el.textContent ?? "").replace(/\s+/g, " ").trim()),
      );
      return found?.getAttribute("aria-selected") === "true";
    }, name);
    rowTotal += await page.locator("table tbody tr").count();
    const hrefs = await page.locator("table a[href^='/case/']").evaluateAll((links) => [
      ...new Set(links.map((link) => link.getAttribute("href") ?? "").filter(Boolean)),
    ]);
    for (const href of hrefs) {
      expect(seen.has(href), `${href} is in ${seen.get(href)} and ${name}`).toBe(false);
      seen.set(href, name);
    }
  }
  expect(rowTotal).toBe(counts.get("All"));

  for (const mode of ["refresh", "deep"] as const) {
    await visit(page, "/?tab=with_insurer&q=Kirk&insurer=Federation+Health");
    if (mode === "refresh") await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Worklist" }).waitFor();
    await page.getByRole("row", { name: /James T\. Kirk/ }).getByText("MRI lumbar spine", { exact: true }).click();
    await page.waitForURL(/\/case\/case-1-kirk/);
    await page.getByRole("button", { name: "Back to worklist" }).click();
    await page.getByRole("heading", { name: "Worklist" }).waitFor();
    expect(searchParam(page, "tab")).toBe("with_insurer");
    expect(searchParam(page, "q")).toBe("Kirk");
    expect(searchParam(page, "insurer")).toBe("Federation Health");
    expect(await page.getByRole("tab", { name: /With insurer/ }).getAttribute("aria-selected")).toBe("true");
  }

  await visit(page, "/?tab=with_insurer&q=Kirk");
  const link = page.getByRole("link", { name: "James T. Kirk" });
  expect(await link.getAttribute("href")).toBe("/case/case-1-kirk");
  const popupPromise = page.context().waitForEvent("page");
  await link.click({ button: "middle" });
  const popup = await popupPromise;
  await popup.waitForURL(/\/case\/case-1-kirk/);
  expect(page.url()).toContain("tab=with_insurer");
  await popup.close();
}

export async function assertImpact(page: Page): Promise<void> {
  const model = buildImpactModel(WEEKS, "toDate", "all", DEFAULT_ASSUMPTIONS);
  await bothWays(page, "/impact", async () => {
    await see(page.getByRole("heading", { name: model.north.metric.name }));
    expect((await page.locator(".text-metric").first().innerText()).trim()).toBe(model.north.valueText);
    const northTable = page.locator("table").filter({ hasText: model.north.metric.name }).first();
    expect(await lastCompleteValue(northTable)).toBe(model.north.valueText);
    for (const card of model.cards) {
      const article = page.locator("article").filter({ hasText: card.metric.name });
      expect((await article.locator(".text-section").first().innerText()).trim()).toBe(card.valueText);
      expect(await lastCompleteValue(article.locator("table"))).toBe(card.valueText);
    }
  });
}

async function openSection(page: Page, title: string): Promise<void> {
  const button = page.getByRole("button", { name: new RegExp(`^${title}`) });
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
}

async function timelineResults(page: Page): Promise<string[]> {
  const block = page.locator("[data-review='Insurer']");
  await see(block);
  return block.locator(".min-h-8 > span.text-fg").allTextContents();
}

async function tabCounts(page: Page): Promise<Map<string, number>> {
  await page.getByRole("tab", { name: /All/ }).waitFor();
  const tabs = page.getByRole("tab");
  const counts = new Map<string, number>();
  const raw: string[] = [];
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    const text = ((await tabs.nth(i).innerText()) ?? "").replace(/\s+/g, " ").trim();
    raw.push(text);
    const match = /^(.*?)\s*(\d+)$/.exec(text);
    if (match?.[1] && match[2]) counts.set(match[1].trim(), Number(match[2]));
  }
  if (!counts.has("All")) throw new Error(`Tab counts not parsed: ${raw.join(" | ")}`);
  return counts;
}

function searchParam(page: Page, key: string): string | null {
  return new URL(page.url()).searchParams.get(key);
}

async function lastCompleteValue(table: Locator): Promise<string> {
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  for (let i = count - 1; i >= 0; i--) {
    const text = (await rows.nth(i).evaluate((row) => row.textContent ?? "")) ?? "";
    if (text.includes("incomplete")) continue;
    const value = await rows.nth(i).locator("td").nth(1).evaluate((cell) => cell.textContent ?? "");
    return value.trim();
  }
  return "";
}

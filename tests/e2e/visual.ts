import type { Page } from "playwright";
import { shotDir, visit } from "./support";

export const SCREENS: { name: string; path: string }[] = [
  { name: "worklist", path: "/" },
  { name: "worklist-insurer", path: "/?tab=with_insurer" },
  { name: "case-kirk", path: "/case/case-1-kirk" },
  { name: "case-scott", path: "/case/case-2-scott" },
  { name: "case-sulu", path: "/case/case-3-sulu" },
  { name: "case-portal", path: "/case/case-5-chakotay" },
  { name: "case-odo", path: "/case/case-20-odo" },
  { name: "settings", path: "/settings" },
  { name: "settings-handoff", path: "/settings/handoff" },
  { name: "settings-operations", path: "/settings/operations" },
  { name: "analytics", path: "/analytics" },
  { name: "impact", path: "/impact" },
];

export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
] as const;

export interface VisualHit {
  screen: string;
  viewport: string;
  scheme: string;
  problems: string[];
}

export async function reviewScreen(page: Page, screen: (typeof SCREENS)[number], viewport: (typeof VIEWPORTS)[number], scheme: "light" | "dark"): Promise<string[]> {
  await visit(page, screen.path);
  const tag = process.env.E2E_BASE_URL ? "prod" : "local";
  const file = `${shotDir()}${tag}-${screen.name}-${viewport.name}-${scheme}.png`;
  await page.screenshot({ path: file, fullPage: false });
  const problems: string[] = [];
  const scroll = await horizontalScroll(page);
  if (scroll.length) problems.push(`horizontal scroll: ${scroll.join(", ")}`);
  if (screen.path.startsWith("/case") && viewport.name === "1440") {
    const share = await viewerShare(page);
    if (share == null) problems.push("case viewer was not measured");
    else if (share < 0.45) problems.push(`viewer is ${Math.round(share * 100)}% of the case frame`);
  }
  const big = await oversizedText(page);
  if (big.length) problems.push(`text over 20px: ${big.slice(0, 6).join("; ")}`);
  const primaries = await page.locator("button.bg-accent").count();
  if (primaries > 1) problems.push(`${primaries} primary buttons`);
  return problems;
}

async function horizontalScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hits: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) hits.push("document");
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(el);
      if (style.overflowX !== "auto" && style.overflowX !== "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        const name = el.getAttribute("aria-label") || el.className.toString().slice(0, 60) || el.tagName;
        hits.push(name);
      }
    }
    return hits.slice(0, 6);
  });
}

async function viewerShare(page: Page): Promise<number | null> {
  const separator = page.getByRole("separator", { name: "Resize document viewer" });
  if ((await separator.count()) === 0) return null;
  const frame = separator.locator("xpath=..");
  const viewer = frame.locator(":scope > div").nth(1);
  const frameBox = await frame.boundingBox();
  const viewerBox = await viewer.boundingBox();
  if (!frameBox || !viewerBox || frameBox.width === 0) return null;
  return viewerBox.width / frameBox.width;
}

async function oversizedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const el = node.parentElement;
      node = walker.nextNode();
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const size = Number.parseFloat(style.fontSize);
      if (size <= 20.5) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      hits.push(`${Math.round(size)}px “${text.slice(0, 40)}”`);
    }
    return hits;
  });
}

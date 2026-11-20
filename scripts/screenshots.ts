// Visual review loop: 1440x900 screenshots of every screen, light and dark, into /screenshots.
// Usage: npm run screenshots -- [--tag before|after] [--url http://localhost:5173]
// Uses the installed Google Chrome (no browser download).

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const tag = arg("tag", "after");
const base = arg("url", "http://localhost:5173");
const only = arg("only", "").split(",").filter(Boolean);
const outDir = new URL("../screenshots/", import.meta.url).pathname;

const SCREENS: { name: string; path: string; prepare?: (page: import("playwright").Page) => Promise<void> }[] = [
  { name: "worklist", path: "/" },
  {
    name: "worklist-nurse",
    path: "/",
    prepare: async (page) => {
      await page.getByRole("tab", { name: /Nurse/ }).click();
    },
  },
  { name: "worklist-insurer", path: "/?tab=with_insurer" },
  { name: "settings-rules", path: "/settings" },
  {
    name: "settings-rules-expanded",
    path: "/settings",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^2b/ }).click();
      await page.getByRole("button", { name: "Details" }).click();
    },
  },
  { name: "analytics", path: "/analytics" },
  { name: "case-kirk", path: "/case/case-1-kirk" },
  {
    name: "case-kirk-cited",
    path: "/case/case-1-kirk",
    prepare: async (page) => {
      await page.getByRole("button", { name: "p.3" }).first().click();
      await page.waitForTimeout(800);
    },
  },
  { name: "case-scott", path: "/case/case-2-scott" },
  { name: "case-sulu", path: "/case/case-3-sulu" },
  { name: "case-portal", path: "/case/case-5-chakotay" },
  { name: "case-odo", path: "/case/case-20-odo" },
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

for (const scheme of ["light", "dark"] as const) {
  if (tag === "before" && scheme === "dark") continue; // dark mode did not exist before the retrofit
  for (const viewport of VIEWPORTS) {
    if (tag === "before" && viewport.name !== "1440") continue;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme });
    const page = await context.newPage();
    for (const s of SCREENS.filter((screen) => only.length === 0 || only.includes(screen.name))) {
      await page.goto(base + s.path);
      await page.waitForLoadState("networkidle");
      if (s.path.startsWith("/case")) {
        await page.locator("canvas, :text('No packet')").first().waitFor({ timeout: 8000 }).catch(() => {});
      }
      await s.prepare?.(page);
      await page.waitForTimeout(300);
      const file = `${outDir}${tag}-${s.name}-${viewport.name}-${scheme}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
    await context.close();
  }
}

await browser.close();

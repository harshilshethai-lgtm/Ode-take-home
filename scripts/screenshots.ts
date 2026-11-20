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
  { name: "case-odo", path: "/case/case-20-odo" },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

for (const scheme of ["light", "dark"] as const) {
  if (tag === "before" && scheme === "dark") continue; // dark mode did not exist before the retrofit
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  for (const s of SCREENS) {
    await page.goto(base + s.path);
    await page.waitForLoadState("networkidle");
    if (s.path.startsWith("/case")) {
      await page.locator("canvas, :text('No packet')").first().waitFor({ timeout: 8000 }).catch(() => {});
    }
    await s.prepare?.(page);
    await page.waitForTimeout(300);
    const file = `${outDir}${tag}-${s.name}-${scheme}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  await context.close();
}

await browser.close();

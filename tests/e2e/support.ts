import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const LOCAL_BASE = "http://127.0.0.1:5199";
export const PRODUCTION_BASE = "https://ode-platform-chi.vercel.app";

const base = () => (process.env.E2E_BASE_URL ?? LOCAL_BASE).replace(/\/$/, "");

let browser: Browser | null = null;
let server: ChildProcess | null = null;
let ocrBin = "";

const problems = new WeakMap<Page, string[]>();

export function appUrl(path: string): string {
  return `${base()}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function launch(): Promise<void> {
  ocrBin = compileOcr();
  if (!process.env.E2E_BASE_URL) await ensureServer();
  browser = await chromium.launch({ channel: "chrome" });
}

export async function stop(): Promise<void> {
  await browser?.close();
  browser = null;
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    server = null;
  }
}

export async function openContext(scheme: "light" | "dark", width: number, height: number): Promise<BrowserContext> {
  if (!browser) throw new Error("Browser is not launched");
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    deviceScaleFactor: 1,
  });
  await context.addInitScript((theme: string) => {
    localStorage.setItem("halcyon.theme", theme);
    localStorage.removeItem("halcyon.case.split.v1");
    localStorage.removeItem("halcyon.assignments.v1");
  }, scheme);
  return context;
}

export async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const found: string[] = [];
  problems.set(page, found);
  page.on("console", (msg) => {
    const text = msg.text();
    if (/unique ["']key["'] prop|Each child in a list should have a unique|Hydration failed|Text content did not match|Minified React error #(418|423|425)/.test(text)) {
      found.push(text.slice(0, 300));
    }
  });
  page.on("pageerror", (err) => {
    if (/Hydration|Minified React error #(418|423|425)/.test(err.message)) found.push(err.message.slice(0, 300));
  });
  page.on("response", (res) => {
    if (res.status() !== 404) return;
    const type = res.request().resourceType();
    if (type === "document") return;
    const url = res.url();
    if (url.startsWith("data:") || url.includes("favicon")) return;
    found.push(`404 ${type} ${url}`);
  });
  return page;
}

export function consoleProblems(page: Page): string[] {
  return problems.get(page) ?? [];
}

export async function visit(page: Page, path: string): Promise<void> {
  const url = appUrl(path);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/.test(message)) throw error;
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await settle(page, path);
}

export async function hardRefresh(page: Page, path: string): Promise<void> {
  await visit(page, path);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, path);
}

async function settle(page: Page, path: string): Promise<void> {
  await page.getByRole("heading").first().waitFor({ timeout: 20_000 });
  if (path.startsWith("/case")) {
    await page.locator("canvas, :text('No packet'), :text('Case not found')").first().waitFor({ timeout: 12_000 }).catch(() => {});
  }
  await page.waitForTimeout(200);
}

export async function bothWays(page: Page, path: string, assert: () => Promise<void>): Promise<void> {
  await hardRefresh(page, path);
  await assert();
  await visit(page, path);
  await assert();
}

export function shotDir(): string {
  const dir = new URL("../../screenshots/e2e/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function fixturePdf(file: string): string {
  if (file === "policy") return "fixtures/policies/insurer-policy-excerpts.pdf";
  const folder = readdirSync("fixtures").find((name) => name.startsWith("case-") && name.endsWith(`-${file}`));
  if (!folder) throw new Error(`No fixture PDF for ${file}`);
  return `fixtures/${folder}/input.pdf`;
}

/** Scott's cover lists fax page 4, which is not in the file. Later fax pages shift back one PDF page. */
const SCOTT_FAX_TO_PDF: Record<number, number> = { 1: 1, 2: 2, 3: 3, 5: 4, 6: 5 };

export function citedPdfPage(file: string, label: string): number | null {
  const match = /^(?:fax )?p\.(\d+)$/.exec(label.trim());
  if (!match) return null;
  const shown = Number(match[1]);
  if (label.startsWith("fax") && file === "scott") return SCOTT_FAX_TO_PDF[shown] ?? null;
  return shown;
}

const textCache = new Map<string, { text: string; source: "extracted" | "ocr" }>();

export async function textOfCitedPage(file: string, page: number): Promise<{ text: string; source: "extracted" | "ocr" }> {
  const key = `${file}:${page}`;
  const cached = textCache.get(key);
  if (cached) return cached;
  const path = fixturePdf(file);
  const extracted = await pdfText(path, page);
  const result = extracted.trim()
    ? { text: extracted, source: "extracted" as const }
    : { text: execFileSync(ocrBin, [path, String(page)], { encoding: "utf8" }), source: "ocr" as const };
  textCache.set(key, result);
  return result;
}

export function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function pdfText(path: string, page: number): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, disableWorker: true } as Parameters<typeof getDocument>[0]).promise;
  if (page < 1 || page > doc.numPages) return "";
  const content = await doc.getPage(page).then((item) => item.getTextContent());
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

function compileOcr(): string {
  const out = "/tmp/ode-ocr-page";
  execFileSync("clang", ["-fobjc-arc", "-framework", "AppKit", "-framework", "PDFKit", "-framework", "Vision", "-o", out, "scripts/ocr-page.m"], {
    stdio: "inherit",
  });
  return out;
}

async function ensureServer(): Promise<void> {
  if (await reachable(LOCAL_BASE)) return;
  const log = createWriteStream("/tmp/ode-e2e-vite.log");
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5199", "--strictPort"], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on("exit", (code) => {
    log.write(`\nvite exited ${code}\n`);
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await reachable(LOCAL_BASE)) return;
    if (server.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start on 5199");
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

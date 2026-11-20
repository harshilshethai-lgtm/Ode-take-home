// @vitest-environment jsdom
// Copy budget: render each page with seed data and assert the design rules that are about words, not pixels.
// Rules: .cursor/rules/design.mdc

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersonaProvider } from "@/lib/persona";
import { OrdersProvider } from "@/lib/useWorklistState";

// Node 25 ships an experimental global localStorage that shadows jsdom's and is unusable without a file.
// Install a plain in-memory one before any app module reads it.
vi.hoisted(() => {
  const data = new Map<string, string>();
  const mem = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => s.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
const SNAKE = /\b[a-z]+_[a-z_]+\b/;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(path: string) {
  root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>
          <PersonaProvider>
            <OrdersProvider>
              <App />
            </OrdersProvider>
          </PersonaProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );
  });
}

const click = (el: Element) => act(() => (el as HTMLElement).click());

/** Every assertion that applies to one rendered state of a page. */
function assertBudget() {
  // One h1, title only: no paragraph under it.
  const h1s = host.querySelectorAll("h1");
  expect(h1s.length).toBe(1);
  const h1 = h1s[0];
  expect(h1.nextElementSibling?.tagName).not.toBe("P");
  expect(h1.parentElement!.querySelectorAll("p").length).toBe(0);
  expect(words(h1.textContent ?? "")).toBeLessThanOrEqual(3);

  // Helper text: one line, at most 12 words.
  for (const el of host.querySelectorAll("p, [data-helper]")) {
    expect(words(el.textContent ?? ""), `helper text too long: "${el.textContent}"`).toBeLessThanOrEqual(12);
  }

  // No row with more than 2 visible chips.
  for (const row of host.querySelectorAll("tr, li, [data-row]")) {
    const chips = row.querySelectorAll("[data-chip]").length;
    expect(chips, `row has ${chips} chips: ${row.textContent?.slice(0, 60)}`).toBeLessThanOrEqual(2);
  }

  // The AI summary: at most 2 sentences and 40 words.
  for (const el of host.querySelectorAll("[data-ai-summary]")) {
    const t = el.textContent ?? "";
    expect(words(t), "AI summary over 40 words").toBeLessThanOrEqual(40);
    expect(sentences(t), "AI summary over 2 sentences").toBeLessThanOrEqual(2);
  }

  // No internal identifier (snake_case) in anything the user can read.
  const visible = host.textContent ?? "";
  expect(visible.match(SNAKE)?.[0], "internal key visible in UI").toBeUndefined();
}

describe("copy budget", () => {
  it("Worklist: every tab", () => {
    render("/");
    assertBudget();
    expect(host.querySelectorAll("tbody tr[data-row-key]").length).toBeGreaterThan(0);
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      click(tab);
      assertBudget();
    }
    // 36px rows live in DataTable; the table never has more than 8 columns.
    expect(host.querySelectorAll("thead th").length).toBeLessThanOrEqual(8);
  });

  it("Settings: every section, every row expanded", () => {
    render("/settings");
    for (const nav of host.querySelectorAll('nav[aria-label="Settings sections"] button')) {
      click(nav);
      for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
      assertBudget();
    }
  });

  it("Analytics", () => {
    render("/analytics");
    assertBudget();
  });

  it("Case placeholder", () => {
    render("/case/case-1-kirk");
    assertBudget();
  });
});

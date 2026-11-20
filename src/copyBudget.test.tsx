// @vitest-environment jsdom
// Copy budget: render each page with seed data and assert the design rules that are about words, not pixels.
// Rules: .cursor/rules/design.mdc

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SEED_ORDERS } from "@/data/orders";
import { rulesApi } from "@/data/rules";
import { recordOrderEvaluations } from "@/data/rules/orderEvaluations";
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
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserver, configurable: true });
  }
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

  it("Settings: rule library list, then a policy card with every row expanded", () => {
    render("/settings");
    assertBudget();
    const rows = [...host.querySelectorAll('nav[aria-label="Settings sections"] ~ div button')].filter(
      (b) => b.textContent?.includes("Active") && /\(v\d+\)/.test(b.textContent ?? ""),
    );
    expect(rows.length).toBe(3);
    expect(host.textContent).toContain("Recent changes");
    expect(host.textContent).toContain("New policy");
    click([...rows].find((r) => r.textContent?.includes("RAD-114"))!);
    for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
    assertBudget();
    expect(host.textContent).toContain("Red flagsWaives 2a, 2b, 2c");
    expect(host.textContent).toContain("Source · 2b");
    expect(host.textContent).not.toContain("Patient-reported");
    expect(host.textContent).toContain("Submit viaAPI or Portal");
  });

  it("Settings: version panel and a superseded version", () => {
    render("/settings?policy=pol_rad114");
    assertBudget();
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Versions"))!;
    click(open);
    // the panel renders in a portal
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("Superseded");
    expect(panel.textContent).toContain("Active");
    const v2 = [...panel.querySelectorAll("li button")].find((b) => b.textContent?.includes("v2"))!;
    click(v2);
    expect(host.textContent).toContain("You're viewing v2 (superseded Jan 1, 2026).");
    expect(host.textContent).toContain("View active version");
    assertBudget();
    click([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("View active version"))!);
    expect(host.textContent).not.toContain("You're viewing");
  });

  it("Settings: compare view", () => {
    render("/settings?policy=pol_rad114&compare=ver_rad114_1,ver_rad114_3");
    assertBudget();
    expect(host.textContent).toContain("Added");
    expect(host.textContent).toContain("Changed");
  });

  it("Operations", () => {
    render("/analytics");
    assertBudget();
    expect(host.textContent).toContain("Operations");
    expect(host.textContent).toContain("Illustrative data");
    expect(host.textContent).toContain("Missing docs 2");
    expect(host.textContent).toContain("Criteria not met 3");
    expect(host.textContent).toContain("Under 6 weeks 1");
    expect(host.textContent).toContain("Done today: none");
  });

  it("Impact", () => {
    render("/impact");
    assertBudget();
    expect(host.textContent).toContain("Pilot impact");
    expect(host.textContent).toContain("Illustrative data");
    for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
    assertBudget();
  });

  it("Case: Kirk, sections expanded", () => {
    render("/case/case-1-kirk");
    expect(host.textContent).toContain("ORD-58213");
    for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
    assertBudget();
  });

  it("Case: Scott fax", () => {
    render("/case/case-2-scott");
    expect(host.textContent).toContain("ORD-58242");
    expect(host.textContent).toContain("Fax");
    for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
    assertBudget();
  });

  it("Case: Sulu order", () => {
    render("/case/case-3-sulu");
    expect(host.textContent).toContain("ORD-58258");
    expect(host.textContent).toContain("Ask Dr McCoy to order an X-ray");
    for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
    assertBudget();
  });

  it("Case: Odo's blank fax", () => {
    render("/case/case-20-odo");
    assertBudget();
    expect(host.textContent).toContain("Promenade Urgent Care");
    expect(host.textContent).toContain("Blank fax");
  });

  describe("after a rule changes", () => {
    const editor = { id: "e", name: "Ed Itor", role: "editor" as const };
    const approver = { id: "a", name: "App Rover", role: "approver" as const };
    beforeEach(() => {
      rulesApi.reset();
      recordOrderEvaluations(rulesApi, SEED_ORDERS);
      const draft = rulesApi.createDraft("pol_rad114", { actor: editor });
      rulesApi.patchVersion(draft.id, { criteria: draft.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, properties: c.properties.map((p) => (p.key === "duration" ? { ...p, value: 8 } : p)) } : c)) }, editor);
      rulesApi.publishVersion(draft.id, { effectiveFrom: "2026-11-09", changeNote: "Raises the symptom duration." }, approver);
    });
    afterEach(() => rulesApi.reset());

    it("Case: rules-changed banner", () => {
      render("/case/case-1-kirk");
      expect(host.querySelectorAll('[role="status"]').length).toBe(1);
      for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
      assertBudget();
    });

    it("Settings: Operations re-check queue", () => {
      render("/settings");
      click([...host.querySelectorAll('nav[aria-label="Settings sections"] a')].find((b) => b.textContent === "Operations")!);
      expect(host.textContent).toContain("Needs re-check");
      for (const toggle of host.querySelectorAll("button[aria-expanded=false]")) click(toggle);
      assertBudget();
    });
  });
});

// @vitest-environment jsdom
// Evaluation traceability in the UI: "Checked against ... v3", the rules-changed banner, and the Operations queue.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SEED_ORDERS } from "@/data/orders";
import { rulesApi } from "@/data/rules";
import { recordOrderEvaluations } from "@/data/rules/orderEvaluations";
import type { RulesUser } from "@/domain/rules/types";
import { PersonaProvider } from "@/lib/persona";
import { staleCases } from "@/lib/staleCases";
import { OrdersProvider } from "@/lib/useWorklistState";

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

const SNAKE = /\b[a-z]+_[a-z_]+\b/;
const editor: RulesUser = { id: "e", name: "Ed Itor", role: "editor" };
const approver: RulesUser = { id: "a", name: "App Rover", role: "approver" };
let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  rulesApi.reset();
  recordOrderEvaluations(rulesApi, SEED_ORDERS);
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
});

function render(path: string) {
  const r = createRoot(host);
  root = r;
  act(() => {
    r.render(
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

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
};
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label)) ?? null;
const text = () => document.body.textContent ?? "";

/** RAD-114 v4: one criterion changes (symptom duration), effective on or before the cases' service dates. */
function publishRadV4(effectiveFrom = "2026-11-09") {
  const draft = rulesApi.createDraft("pol_rad114", { actor: editor });
  const criteria = draft.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, properties: c.properties.map((p) => (p.key === "duration" ? { ...p, value: Number(p.value) + 2 } : p)) } : c));
  rulesApi.patchVersion(draft.id, { criteria }, editor);
  return rulesApi.publishVersion(draft.id, { effectiveFrom, changeNote: "Raises the symptom duration." }, approver);
}

const radCases = () => SEED_ORDERS.filter((o) => o.policyRef?.startsWith("RAD-114") && o.orderNumber && rulesApi.getLatestEvaluationFor(o.orderNumber));

describe("order evaluations", () => {
  it("every case checked against a rule has one stored evaluation, pinned to the version that governed it", () => {
    const checked = SEED_ORDERS.filter((o) => o.orderNumber && rulesApi.getLatestEvaluationFor(o.orderNumber));
    expect(checked.length).toBeGreaterThanOrEqual(7);
    for (const o of checked) {
      const e = rulesApi.getLatestEvaluationFor(o.orderNumber!)!;
      expect(e.policyVersionId).toBe(e.rulesSnapshot?.versionId);
      expect(e.rulesSnapshot!.criteria.length).toBeGreaterThan(0);
      expect(rulesApi.listEvaluations().filter((x) => x.orderRef === o.orderNumber)).toHaveLength(1);
    }
    expect(recordOrderEvaluations(rulesApi, SEED_ORDERS)).toBe(0); // safe to run on every load
  });

  it("nothing is stale until a newer version applies", () => {
    expect(staleCases(SEED_ORDERS, rulesApi)).toHaveLength(0);
    publishRadV4("2027-06-01"); // after every service date
    expect(staleCases(SEED_ORDERS, rulesApi)).toHaveLength(0);
  });

  it("only unsubmitted cases are flagged", () => {
    publishRadV4();
    const stale = staleCases(SEED_ORDERS, rulesApi);
    expect(stale.length).toBeGreaterThan(0);
    for (const s of stale) {
      expect(["submitted", "approved", "denied", "cancelled", "not_required"]).not.toContain(s.order.status);
      expect(s.order.policyRef).toMatch(/^RAD-114/);
    }
    const sent = SEED_ORDERS.filter((o) => o.policyRef?.startsWith("RAD-114") && o.orderNumber && ["submitted", "approved"].includes(o.status));
    for (const o of sent) expect(stale.find((s) => s.order.id === o.id)).toBeUndefined();
  });
});

describe("case view", () => {
  const unsubmitted = () => radCases().find((o) => staleCasesFor(o));
  const staleCasesFor = (o: (typeof SEED_ORDERS)[number]) => !["submitted", "approved", "denied", "cancelled", "not_required"].includes(o.status);

  it("says which version the check used, linking to that exact version", () => {
    const order = unsubmitted()!;
    render(`/case/${order.id}`);
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Checked against Federation Health RAD-114 v3");
    expect(link, text().slice(0, 400)).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/settings?policy=pol_rad114&v=ver_rad114_3");
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("shows the rules-changed banner with the criteria that changed, and Re-run clears it", () => {
    const order = unsubmitted()!;
    publishRadV4();
    render(`/case/${order.id}`);
    const banner = document.querySelector('[role="status"]')!;
    expect(banner.textContent).toContain("Rules changed since this check (v3 → v4) · 1 criterion affected");
    expect(banner.textContent).toContain("Changed: Symptoms ≥ 6 wks (changed)");
    expect(banner.textContent?.match(SNAKE)?.[0]).toBeUndefined();
    click([...banner.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Re-run")));
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(text()).toContain("Checked against Federation Health RAD-114 v4");
  });
});

describe("evaluation page", () => {
  it("shows the same link and banner", () => {
    const order = radCases()[0];
    const e = rulesApi.getLatestEvaluationFor(order.orderNumber!)!;
    publishRadV4();
    render(`/evaluations/${e.id}`);
    expect(text()).toContain("Checked against Federation Health RAD-114 v3");
    expect(text()).toContain("Rules changed since this check (v3 → v4) · 1 criterion affected");
    expect(text()).toContain("Changed: Symptoms ≥ 6 wks (changed)");
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Checked against Federation Health RAD-114 v3");
    expect(link!.getAttribute("href")).toBe("/settings?policy=pol_rad114&v=ver_rad114_3");
  });
});

describe("Operations queue", () => {
  const goOperations = () => {
    render("/settings");
    click([...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find((b) => b.textContent === "Operations"));
  };

  it("is empty while every check is current", () => {
    goOperations();
    expect(text()).toContain("Needs re-check");
    expect(text()).toContain("Every unsubmitted case was checked against the rules that apply.");
  });

  it("lists unsubmitted cases on an old version and bulk re-checks the selected ones", () => {
    publishRadV4();
    const before = staleCases(SEED_ORDERS, rulesApi);
    expect(before.length).toBeGreaterThanOrEqual(2);
    goOperations();
    expect(text()).toContain(`Needs re-check${before.length}`);
    expect(text()).toContain("Federation Health RAD-114 v3 → v4");
    expect(text()).toContain("Symptoms ≥ 6 wks (changed)");
    expect(text().match(SNAKE)?.[0]).toBeUndefined();

    const rechecks = () => button("Re-check") as HTMLButtonElement;
    expect(rechecks().disabled).toBe(true);
    click(document.querySelector('input[aria-label="Select all"]'));
    expect(rechecks().textContent).toBe(`Re-check ${before.length}`);
    click(rechecks());

    expect(staleCases(SEED_ORDERS, rulesApi)).toHaveLength(0);
    expect(text()).toContain(`Re-checked ${before.length} cases.`);
    for (const s of before) expect(rulesApi.getLatestEvaluationFor(s.order.orderNumber!)!.rulesSnapshot?.versionNumber).toBe(4);
  });

  it("re-checks only the rows that are ticked", () => {
    publishRadV4();
    const before = staleCases(SEED_ORDERS, rulesApi);
    goOperations();
    const first = before[0];
    click(document.querySelector(`input[aria-label="Select ${first.order.patient?.name ?? first.order.orderNumber}"]`));
    click(button("Re-check 1"));
    expect(staleCases(SEED_ORDERS, rulesApi)).toHaveLength(before.length - 1);
  });
});

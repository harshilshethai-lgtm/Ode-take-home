// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ResultPill, RESULT_PRESENTATION } from "@/components/ui/result-pill";
import { SEED_ORDERS } from "@/data/orders";
import { getReviewPanel } from "@/domain/review/panel";
import type { CheckResult } from "@/domain/review/types";
import { PersonaProvider } from "@/lib/persona";
import { OrdersProvider } from "@/lib/useWorklistState";
import { ReviewPanelView } from "./ReviewPanel";

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

function render(node: ReactNode) {
  root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <TooltipProvider>{node}</TooltipProvider>
      </MemoryRouter>,
    );
  });
}

describe("result pills", () => {
  it("prints a word for every result", () => {
    const results = Object.keys(RESULT_PRESENTATION) as CheckResult[];
    render(
      <div>
        {results.map((result) => (
          <ResultPill key={result} result={result} />
        ))}
      </div>,
    );
    for (const result of results) expect(host.textContent).toContain(RESULT_PRESENTATION[result].label);
  });
});

describe("review panel interactions", () => {
  it("opens the cited page and quote from a page chip", () => {
    const order = SEED_ORDERS.find((item) => item.id === "case-17-obrien")!;
    const panel = getReviewPanel(order.id, "coordinator", order);
    const opened: Array<{ page: number; quote?: string }> = [];
    render(
      <ReviewPanelView
        panel={panel}
        order={order}
        role="coordinator"
        actorId="p-jasmine"
        onOpen={(cite) => opened.push({ page: cite.page, quote: cite.quote })}
        onApplied={() => {}}
      />,
    );
    const chip = [...host.querySelectorAll("button")].find((button) => button.textContent === "p.2");
    expect(chip).toBeTruthy();
    act(() => chip!.click());
    expect(opened[0]).toMatchObject({ page: 2, quote: "MRI L knee" });
  });

  it("keeps evidence collapsed when every check passed", () => {
    const order = SEED_ORDERS.find((item) => item.id === "case-1-kirk")!;
    const panel = getReviewPanel(order.id, "coordinator", order);
    render(
      <ReviewPanelView panel={panel} order={order} role="coordinator" actorId="p-jasmine" onOpen={() => {}} onApplied={() => {}} />,
    );
    expect(host.querySelector('[data-review="Evidence"]')).toBeNull();
    expect(host.textContent).not.toContain("All evidence linked on each check");
  });

  it("is read-only for a role that does not own the status", () => {
    const order = SEED_ORDERS.find((item) => item.id === "case-17-obrien")!;
    const panel = getReviewPanel(order.id, "nurse", order);
    render(
      <ReviewPanelView panel={panel} order={order} role="nurse" actorId="p-priya" onOpen={() => {}} onApplied={() => {}} />,
    );
    expect(host.textContent).toContain("Owned by coordinator");
    expect(host.textContent).not.toContain("Notify ordering doctor");
  });

  it("moves the document pane to the cited page", () => {
    root = createRoot(host);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/case/case-17-obrien"]}>
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
    const chip = [...host.querySelectorAll("button")].find((button) => button.textContent === "p.3");
    expect(chip).toBeTruthy();
    act(() => chip!.click());
    expect(host.textContent).toContain("3 of");
  });
});

// @vitest-environment jsdom
// Editing a rule policy end to end: Edit rules -> draft -> inline edits -> validation -> publish, plus New policy.
// Runs the real Settings page against the seeded store.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { rulesApi } from "@/data/rules";
import { PersonaProvider } from "@/lib/persona";
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
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  rulesApi.reset();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
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

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
};

function type(el: Element | null, value: string) {
  if (!el) throw new Error("input not found");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const button = (text: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) ?? null;
const input = (label: string, scope: ParentNode = document.body) => scope.querySelector(`[aria-label="${label}"]`) ?? [...scope.querySelectorAll("label")].map((l) => (l.textContent === label ? document.getElementById(l.htmlFor) : null)).find(Boolean) ?? null;
const text = () => document.body.textContent ?? "";

const RAD = "pol_rad114";
const versionsOf = (policyId: string) => rulesApi.getPolicy(policyId).versions;

describe("rule editing", () => {
  it("Edit rules clones the active version into a draft and opens it in edit mode", () => {
    render(`/settings?policy=${RAD}`);
    expect(text()).not.toContain("Discard draft"); // read-only is the default
    click(button("Edit rules"));

    const draft = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(draft.versionNumber).toBe(4);
    expect(draft.clonedFromVersionId).toBe("ver_rad114_3");
    expect(draft.criteria.length).toBe(rulesApi.getVersion(RAD, "ver_rad114_3").version.criteria.length);
    expect(text()).toMatch(/Draft v4 · saved/);
    expect(button("Discard draft")).not.toBeNull();
    expect(button("Publish")).not.toBeNull();
    expect(text().match(SNAKE)?.[0]).toBeUndefined();
  });

  it("with a draft open, the button continues it and names who is drafting", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("Done"));
    expect(text()).not.toContain("Discard draft");
    expect(versionsOf(RAD).filter((v) => v.status === "draft").length).toBe(1);
    // Back on the active version: the draft is the thing to continue.
    click(button("Versions"));
    click([...document.querySelectorAll('[role="dialog"] li button')].find((b) => b.textContent?.includes("v3")));
    expect(button("Continue draft (by Jasmine)")).not.toBeNull();
    expect(button("Edit rules")).toBeNull();
    click(button("Continue draft"));
    expect(text()).toMatch(/Draft v4/);
    expect(versionsOf(RAD).filter((v) => v.status === "draft").length).toBe(1);
  });

  it("edits a criterion inline and saves it to the draft", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("2b"));
    type(input("Label"), "Conservative care for 8 weeks");
    click(button("Done")); // leaving flushes the autosave
    const saved = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(saved.criteria.some((c) => c.displayLabel === "Conservative care for 8 weeks")).toBe(true);
    // The published version it came from is untouched.
    expect(rulesApi.getVersion(RAD, "ver_rad114_3").version.criteria.some((c) => c.displayLabel === "Conservative care for 8 weeks")).toBe(false);
  });

  it("a missing source excerpt shows inline and blocks publishing, but the draft still saves", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    expect(button("Publish…")!.disabled).toBe(false);
    click(button("2a"));
    type(input("Source text"), "");
    expect(text()).toContain("paste the verbatim insurer text this criterion encodes");
    expect(button("Publish…")!.disabled).toBe(true);
    expect(text()).toMatch(/1 error blocks publishing/);
    click(button("Done"));
    const saved = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(saved.criteria[0].excerpt).toBe("");
  });

  it("deleting a criterion that a waiver points to is flagged on the waiver", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(document.querySelector('[aria-label^="Delete Symptoms"]'));
    expect(text()).toContain("which is not a criterion in this version");
    expect(button("Publish…")!.disabled).toBe(true);
  });

  it("adds a criterion, then its properties: one checked, one not auto-checked", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    const before = versionsOf(RAD).find((v) => v.status === "draft")!.criteria.length;
    click(button("Add criterion"));
    expect(text()).toContain("Untitled criterion");
    type(input("Label"), "Pain for 3 weeks");
    type(input("Insurer ref"), "2e");

    const addProperty = (name: string, valueType: string, op?: string, fact?: string) => {
      click([...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add property").at(-1));
      const pop = document.querySelector('[role="dialog"]')!;
      type(input("Name", pop), name);
      click(button(valueType, pop));
      if (op) {
        type(input("Check (optional)", pop), op);
        type(input("Fact", pop), fact!);
      }
      click(button("Add", pop));
    };
    addProperty("Duration", "Number", "min_weeks", "symptom_onset");
    expect(text()).not.toContain("Not auto-checked");
    addProperty("Severity", "Text");
    expect(text()).toContain("Not auto-checked");

    click(button("Done"));
    const draft = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(draft.criteria.length).toBe(before + 1);
    expect(draft.criteria.at(-1)).toMatchObject({
      displayLabel: "Pain for 3 weeks",
      ref: "2e",
      properties: [
        { key: "duration", label: "Duration", value: 1, unit: "weeks", check: { op: "min_weeks", fact: "symptom_onset" } },
        { key: "severity", label: "Severity", value: "" },
      ],
    });
  });

  it("policy properties: one click adds a known one, which then drives the app", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add property"));
    click(button("Incomplete requests", document.querySelector('[role="dialog"]')!));
    click(button("Done"));
    const draft = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(draft.properties.find((p) => p.key === "incomplete_requests")?.value).toBe("deny_resubmit_new");
  });

  it("publishes the draft: it becomes active and v3 is superseded", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("Publish…"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect((button("Publish", dialog) as HTMLButtonElement).disabled).toBe(true); // change note required
    type(input("Change note", dialog), "No changes, republished.");
    click(button("Publish", dialog));
    const vs = versionsOf(RAD);
    expect(vs.find((v) => v.versionNumber === 4)).toMatchObject({ status: "published", derivedStatus: "active" });
    expect(vs.find((v) => v.versionNumber === 3)?.derivedStatus).toBe("superseded");
    expect(text()).not.toContain("Discard draft");
  });

  it("discarding takes two clicks and archives the draft", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("Discard draft"));
    expect(versionsOf(RAD).find((v) => v.status === "draft")).toBeDefined();
    click(button("Confirm discard"));
    expect(versionsOf(RAD).find((v) => v.status === "draft")).toBeUndefined();
    expect(versionsOf(RAD).find((v) => v.versionNumber === 4)?.status).toBe("archived");
    expect(button("Edit rules")).not.toBeNull();
  });

  it("New policy is read-only in the prototype", () => {
    render("/settings");
    const create = button("New policy") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    click(create);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("CPT codes, plan types and waiver triggers are chips", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    const cpt = input("CPT codes")!;
    type(cpt, "72150");
    act(() => cpt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(text()).toContain("72150");
    click(button("Done"));
    expect(versionsOf(RAD).find((v) => v.status === "draft")!.applicability.cptCodes).toContain("72150");
  });
});

const tester = { id: "t1", name: "Test Approver", role: "approver" as const };
const strong = () => [...document.querySelectorAll("strong")].map((s) => s.textContent);

/** v4 for RAD-114: symptom duration 6 -> 8 weeks, starting Dec 1 (still in the demo year, so it shows as "Dec 1"). */
function scheduleV4(effectiveFrom = "2026-12-01") {
  const d = rulesApi.createDraft(RAD, { actor: tester });
  rulesApi.patchVersion(
    d.id,
    { criteria: d.criteria.map((c) => (c.key === "symptom_duration" ? { ...c, properties: c.properties.map((p) => (p.key === "duration" ? { ...p, value: 8 } : p)) } : c)) },
    tester,
  );
  return rulesApi.publishVersion(d.id, { effectiveFrom, changeNote: "Symptoms now need 8 weeks." }, tester);
}

describe("compare, publish and change visibility", () => {
  it("Compare in the Versions panel picks two versions and shows added, removed and changed", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Versions"));
    const panel = () => document.querySelector('[role="dialog"]')!;
    const item = (n: string) => [...panel().querySelectorAll("li")].find((li) => li.textContent?.includes(`v${n}`))!;
    click(button("Compare", item("1")));
    expect(panel().textContent).toContain("Compare v1 with…");
    click([...item("2").querySelectorAll("button")][0]);

    expect(text()).toContain("Compare");
    expect(text()).toContain("Added");
    expect(text()).toMatch(/X-rays first/);
    expect(text()).toMatch(/\d+ changes?/);

    // v2 -> v3: the lookback widened, with the new value in bold
    type(input("From"), "ver_rad114_2");
    type(input("To"), "ver_rad114_3");
    expect(text()).toContain("Changed");
    expect(text()).toMatch(/Lookback: 3 months → 6 months/);
    expect(strong()).toContain("6");
  });

  it("orders the pair oldest first whichever way it was given", () => {
    render(`/settings?policy=${RAD}&compare=ver_rad114_2,ver_rad114_1`);
    expect(text()).toMatch(/v1.*→.*v2/s);
    expect(text()).toContain("Added");
    expect(text()).not.toContain("Removed");
  });

  it("shows a removed criterion struck through and a changed waiver scope", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(document.querySelector('[aria-label^="Delete No MRI"]'));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Red flags")));
    click([...document.querySelectorAll('[aria-pressed="true"]')].find((b) => b.textContent?.includes("2c")));
    click(button("Review changes"));
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain("Removed");
    expect([...sheet.querySelectorAll(".line-through")].some((e) => e.textContent?.includes("No MRI in 12 mo"))).toBe(true);
    expect(sheet.textContent).toContain("Waivers");
    expect(sheet.textContent).toMatch(/Waiver scope: .*X-rays first.* → /s);
  });

  it("Review changes in edit mode shows what this draft changes", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("2a"));
    type(input("Duration"), "8");
    click(button("Review changes"));
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain("Compared with v3");
    expect(sheet.textContent).toContain("Changed");
    expect(sheet.textContent).toMatch(/Duration: 6 weeks → 8 weeks/);
    expect([...sheet.querySelectorAll("strong")].map((s) => s.textContent)).toContain("8");
  });

  it("Review changes is unavailable for the first version of a new policy", () => {
    const { draft } = rulesApi.createPolicy({ newPayerName: "Bajoran Health", externalPolicyId: "CT-500", title: "CT", bodySite: "brain" }, tester);
    render(`/settings?policy=${rulesApi.getVersionById(draft.id).policy.id}&v=${draft.id}&edit=1`);
    expect((button("Review changes") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Publish v4 with a future date is Scheduled: the dialog says so, the old version stays active", () => {
    render(`/settings?policy=${RAD}`);
    click(button("Edit rules"));
    click(button("Publish…"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Publish v4");
    expect((input("Effective from", dialog) as HTMLInputElement).value).toBe("2026-11-10"); // today on the demo clock
    expect(dialog.textContent).toContain("takes effect today");
    type(input("Effective from", dialog), "2026-12-01");
    expect(dialog.textContent).toContain("Scheduled: v4 takes effect Dec 1. v3 stays active until Nov 30.");
    type(input("Change note", dialog), "Scheduled update.");
    click(button("Publish", dialog));
    const vs = versionsOf(RAD);
    expect(vs.find((v) => v.versionNumber === 4)).toMatchObject({ derivedStatus: "scheduled", effectiveFrom: "2026-12-01" });
    expect(vs.find((v) => v.versionNumber === 3)).toMatchObject({ derivedStatus: "active", effectiveTo: "2026-11-30" });
    expect(text()).toContain("You're viewing v4 (scheduled, starts Dec 1, 2026).");
  });

  it("Publish blocks a date that overlaps a scheduled version", () => {
    scheduleV4("2026-12-01");
    const d = rulesApi.createDraft(RAD, { actor: tester });
    render(`/settings?policy=${RAD}&v=${d.id}&edit=1`);
    click(button("Publish…"));
    const dialog = document.querySelector('[role="dialog"]')!;
    type(input("Change note", dialog), "Another one.");
    type(input("Effective from", dialog), "2026-12-01");
    expect(dialog.textContent).toContain("would overlap v4");
    expect((button("Publish", dialog) as HTMLButtonElement).disabled).toBe(true);
    type(input("Effective from", dialog), "2026-12-02");
    expect((button("Publish", dialog) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the active card announces a scheduled version, and View changes opens the diff", () => {
    scheduleV4();
    render(`/settings?policy=${RAD}`);
    expect(text()).toContain("v4 takes effect Dec 1 · 1 change");
    expect(document.querySelectorAll('[role="status"]').length).toBe(1);
    click(button("View changes →"));
    expect(text()).toContain("Compare");
    expect(text()).toMatch(/Duration: 6 weeks → 8 weeks/);
  });

  it("the list row shows what is scheduled and whether a draft is open", () => {
    scheduleV4();
    render("/settings");
    const row = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("MRI of the lumbar spine"))!;
    expect(row().textContent).toContain("v4 scheduled · Dec 1");
    expect(row().textContent).toContain("RAD-114 · Effective 01/01/2026 (v3)");
    expect(row().textContent).toContain("Active");
    expect(row().textContent).not.toContain("Draft");
    act(() => void rulesApi.createDraft(RAD, { actor: tester }));
    expect(row().textContent).toMatch(/Draft/);
  });

  it("Recent changes lists the latest publishes and each row opens its diff", () => {
    scheduleV4();
    render("/settings");
    const strip = () => [...document.querySelectorAll("button")].filter((b) => b.textContent?.includes("Symptoms now need 8 weeks."));
    expect(text()).toContain("Recent changes");
    expect(strip()).toHaveLength(1);
    expect(strip()[0].textContent).toContain("Federation Health");
    expect(strip()[0].textContent).toContain("v4");
    expect(strip()[0].textContent).toContain("Test Approver");
    click(strip()[0]);
    expect(text()).toContain("Compare");
    expect(text()).toMatch(/Duration: 6 weeks → 8 weeks/);
  });

  it("Restore as new draft clones an old version into a draft and never edits history", () => {
    const before = JSON.stringify(versionsOf(RAD).map((v) => [v.id, v.criteria, v.effectiveFrom, v.effectiveTo]));
    render(`/settings?policy=${RAD}`);
    click(button("Versions"));
    const item = [...document.querySelectorAll('[role="dialog"] li')].find((li) => li.textContent?.includes("v1"))!;
    // the active version is not "old": no restore on it
    expect(button("Restore as new draft", [...document.querySelectorAll('[role="dialog"] li')].find((li) => li.textContent?.includes("v3"))!)).toBeNull();
    click(button("Restore as new draft", item));

    const draft = versionsOf(RAD).find((v) => v.status === "draft")!;
    expect(draft).toMatchObject({ versionNumber: 4, clonedFromVersionId: "ver_rad114_1", changeNote: "Rollback to v1." });
    expect(text()).toMatch(/Draft v4/);
    expect(JSON.stringify(versionsOf(RAD).filter((v) => v.status === "published").map((v) => [v.id, v.criteria, v.effectiveFrom, v.effectiveTo]))).toBe(before);
  });

  it("Restore is disabled while a draft is open", () => {
    rulesApi.createDraft(RAD, { actor: tester });
    render(`/settings?policy=${RAD}`);
    click(button("Versions"));
    const item = [...document.querySelectorAll('[role="dialog"] li')].find((li) => li.textContent?.includes("v1"))!;
    expect((button("Restore as new draft", item) as HTMLButtonElement).disabled).toBe(true);
  });
});

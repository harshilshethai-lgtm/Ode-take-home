import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consoleProblems, launch, openContext, openPage, stop } from "./support";
import { assertImpact, assertKirk, assertScott, assertSulu, assertWorklist } from "./golden";
import { citationMisses } from "./citations";
import { reviewScreen, SCREENS, VIEWPORTS } from "./visual";

beforeAll(launch, 120_000);
afterAll(stop);

describe("golden flows", () => {
  it("Kirk is auto-submitted, with four Met rows, an Epic member id, and one submission line", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    await assertKirk(page);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });

  it("Scott is a records hold: missing fax page, at-risk slot, submit blocked, and the six-week citation highlights", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    await assertScott(page);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });

  it("Sulu returns to the provider with a draft and does not chase an X-ray", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    await assertSulu(page);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });

  it("worklist tabs partition, back keeps the filter, and the patient link opens a new tab", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    await assertWorklist(page);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });

  it("impact headlines match the chart and the week fixture", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    await assertImpact(page);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });
});

describe("citation integrity", () => {
  it("every rendered quote is in the cited page text or OCR", async () => {
    const context = await openContext("light", 1440, 900);
    const page = await openPage(context);
    const misses = await citationMisses(page);
    expect(misses.map((miss) => `${miss.caseId} ${miss.label} p.${miss.page} “${miss.quote}” (${miss.source})`)).toEqual([]);
    expect(consoleProblems(page)).toEqual([]);
    await context.close();
  });
});

describe("visual regression", () => {
  it("snapshots every screen at both sizes, light and dark, and rejects layout breaks", async () => {
    const hits: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      for (const viewport of VIEWPORTS) {
        const context = await openContext(scheme, viewport.width, viewport.height);
        const page = await openPage(context);
        for (const screen of SCREENS) {
          const problems = await reviewScreen(page, screen, viewport, scheme);
          for (const problem of problems) hits.push(`${screen.name} ${viewport.name} ${scheme}: ${problem}`);
          for (const problem of consoleProblems(page)) hits.push(`${screen.name} ${viewport.name} ${scheme}: ${problem}`);
        }
        await context.close();
      }
    }
    expect(hits).toEqual([]);
  });
});

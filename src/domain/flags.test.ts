import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { FLAG_ORDER } from "./flags";
import { toRow } from "@/lib/worklist";

const rowFor = (caseNumber: number) => toRow(SEED_ORDERS.find((o) => o.caseNumber === caseNumber)!);
const ids = (caseNumber: number) => rowFor(caseNumber).flags.map((f) => f.id);

describe("Worklist flags", () => {
  it("Kirk (clean, on track, in SLA) carries no flags", () => {
    expect(ids(1)).toEqual([]);
  });

  it("rule violations name the rule they came from", () => {
    const torres = rowFor(6).flags.find((f) => f.id === "rule_violation");
    expect(torres?.detail).toMatch(/^IMG-330/);
  });

  it("stacks derived and finding flags, most severe first", () => {
    // Crusher: scan in 17h, 49h in Awaiting documents (SLA 24h), blank page.
    expect(ids(12)).toEqual(["slot_at_risk", "missing_docs", "over_sla"]);
  });

  it("privacy and coverage findings surface as their own flags", () => {
    expect(ids(15)).toContain("safety");
    expect(ids(18)).toContain("coverage");
  });

  it("closed orders show no time flags", () => {
    expect(ids(16)).toEqual([]);
    expect(ids(11)).toEqual([]);
  });

  it("every flag id appears in the severity order exactly once", () => {
    expect(new Set(FLAG_ORDER).size).toBe(FLAG_ORDER.length);
  });
});

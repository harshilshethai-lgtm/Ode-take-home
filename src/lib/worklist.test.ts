import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { byRiskThenScan, inView, toRow } from "@/lib/worklist";

describe("worklist order", () => {
  const rows = SEED_ORDERS.map((order) => toRow(order));

  it("puts at-risk scans ahead of on-track ones and rows with no slot last", () => {
    const sorted = [...rows].sort(byRiskThenScan);
    const group = (row: (typeof rows)[number]) =>
      !row.order.scheduledAt ? 2 : row.atRisk || row.risk === "slot_at_risk" || row.risk === "at_risk" ? 0 : 1;
    const groups = sorted.map(group);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).toBeGreaterThanOrEqual(groups[i - 1]);
    expect(sorted.at(-1)?.order.scheduledAt).toBeNull();
    expect(sorted[0].order.scheduledAt).toBeTruthy();
  });

  it("keeps nurse review in the nurse tab and closed orders out of it", () => {
    const nurse = rows.filter((row) => inView(row, "clinical"));
    expect(nurse.length).toBeGreaterThan(0);
    expect(nurse.every((row) => row.order.status === "needs_clinical_review")).toBe(true);
    expect(rows.filter((row) => inView(row, "all")).length).toBe(rows.length);
  });
});

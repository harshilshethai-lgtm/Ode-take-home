import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { byDue, duePrimary, inView, nextStep, scanCaption, toRow } from "@/lib/worklist";

describe("worklist order", () => {
  const rows = SEED_ORDERS.map((order) => toRow(order));

  it("sorts past due, then at risk, then submit-by, and leaves rows with no slot last", () => {
    const sorted = [...rows].sort(byDue);
    const group = (row: (typeof rows)[number]) => {
      if (!row.submitBy) return 3;
      if (row.pastDue) return 0;
      if (!row.closed && (row.atRisk || row.risk === "at_risk" || row.risk === "slot_at_risk")) return 1;
      return 2;
    };
    const groups = sorted.map(group);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).toBeGreaterThanOrEqual(groups[i - 1]);
    expect(sorted.at(-1)?.order.scheduledAt).toBeNull();
    expect(sorted[0].pastDue).toBe(true);
  });

  it("reads Scott as past due, with the scan under the countdown and a reschedule step", () => {
    const scott = rows.find((row) => row.order.id === "case-2-scott");
    expect(scott).toBeTruthy();
    expect(duePrimary(scott!).text.startsWith("Past due")).toBe(true);
    expect(scanCaption(scott!)).toBe("scan Thu 11/12 9:00 AM");
    expect(nextStep(scott!).text).toBe("Reschedule scan or request expedited review");
    expect(nextStep(scott!).text.length).toBeLessThanOrEqual(60);
    expect(inView(scott!, "at_risk")).toBe(true);
  });

  it("writes the next step from the top blocker", () => {
    const step = (id: string) => nextStep(rows.find((row) => row.order.id === id)!).text;
    expect(step("case-3-sulu")).toBe("Send to Dr. McCoy");
    expect(step("case-5-chakotay")).toBe("Upload to Ferengi portal");
    expect(step("case-17-obrien")).toBe("Fix side mismatch (order L, records R)");
    expect(step("case-12-crusher")).toBe("Chase the office note · the ordering office");
    for (const row of rows) expect(nextStep(row).text.length).toBeLessThanOrEqual(60);
  });

  it("keeps nurse review in the nurse tab and closed orders out of it", () => {
    const nurse = rows.filter((row) => inView(row, "clinical"));
    expect(nurse.length).toBeGreaterThan(0);
    expect(nurse.every((row) => row.order.status === "needs_clinical_review")).toBe(true);
    expect(rows.filter((row) => inView(row, "all")).length).toBe(rows.length);
  });
});

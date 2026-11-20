import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { previewInsurerPanel } from "@/domain/insurer/view";
import { displayedNextCheck, runStatusCheck, settleDueCheck } from "@/domain/statusPoll";
import { DEMO_NOW, parseDemoInstant } from "@/lib/demoClock";

const kirk = SEED_ORDERS.find((order) => order.id === "case-1-kirk")!;

describe("status polling", () => {
  it("shows Overdue instead of an ago label, then records one check for Kirk", () => {
    const panel = previewInsurerPanel(kirk);
    expect(panel?.nextCheckAt).toBeTruthy();
    expect(parseDemoInstant(panel!.nextCheckAt!).getTime()).toBeLessThan(DEMO_NOW.getTime());
    const label = displayedNextCheck(kirk);
    expect(label).toBe("Overdue");
    expect(label).not.toMatch(/ago/);

    const settled = settleDueCheck(kirk);
    expect(settled?.ran).toBe(true);
    expect(settled?.latestLabel).toBe("In review");
    expect(settled?.nextCheckLabel).not.toMatch(/ago/);
    expect(settled?.nextCheckLabel.startsWith("in ")).toBe(true);
    expect(parseDemoInstant(settled!.nextCheckAt!).getTime()).toBeGreaterThan(DEMO_NOW.getTime());
    expect(settled?.activity?.from).toBe("");
    expect(settled?.activity?.to).toBe("");
    expect(settled?.activity?.reason).toContain("Latest answer: In review");

    const again = runStatusCheck(kirk);
    expect(again?.activity).toMatchObject({ from: "", to: "" });
    expect(again?.activity?.reason).toContain("Latest answer:");
  });
});

import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { buildCaseRecord } from "@/domain/caseRecord";
import { blockersFor, presentWaivers, slotWarning } from "./casePane";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("case pane", () => {
  it("Scott cannot meet the scan slot and names who can send the missing notes", () => {
    const item = order("case-2-scott");
    const record = buildCaseRecord(item);
    expect(slotWarning(item, "2026-11-10T12:52:00.000Z")).toBe("Scan slot can't be met at Ferengi Benefit Group's ~70h turnaround");
    const blockers = blockersFor(item, record);
    expect(blockers[0]).toMatchObject({ item: "PT notes", who: "Utopia Planitia Rehab", fax: "(210) 555-0144" });
    expect(blockers[0]?.cite?.quote).toContain("Utopia Planitia Rehab");
    expect(blockers[1]?.epic).toBe(true);
  });

  it("Sulu's trauma waiver is denied and the later slot can still be met", () => {
    const item = order("case-3-sulu");
    expect(slotWarning(item, "2026-11-10T18:05:00.000Z")).toBeNull();
    const trauma = presentWaivers(item).find((row) => row.id.endsWith("trauma_with_weakness"));
    expect(trauma?.status).toBe("Denied in note");
    expect(trauma?.detail).toContain("doesn't meet");
  });

  it("Kirk's red flags are denied in the note", () => {
    const flags = presentWaivers(order("case-1-kirk"));
    expect(flags.find((row) => row.trigger === "Cauda equina symptoms")?.status).toBe("Denied in note");
  });
});

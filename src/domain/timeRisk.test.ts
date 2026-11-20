import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { businessDaysOnly } from "@/domain/insurer/config";
import { caseReceivedAt } from "@/domain/documents";
import { isSlotUnreachable, SLOT_UNREACHABLE_STEP } from "@/domain/guidance";
import { toRow, nextStep } from "@/lib/worklist";
import { DEMO_NOW, demoDateKey, parseDemoInstant } from "@/lib/demoClock";
import { submitByAt, subtractBusinessDayHours } from "@/domain/timeRisk";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("submit-by", () => {
  it("subtracts the insurer median and 4 business hours, and skips weekends for business-day insurers", () => {
    expect(businessDaysOnly("Ferengi Benefit Group")).toBe(true);
    expect(businessDaysOnly("Federation Health")).toBe(false);

    const scan = parseDemoInstant("2026-11-16T09:00:00");
    const ferengi = submitByAt(scan, "Ferengi Benefit Group");
    const key = demoDateKey(ferengi);
    const dow = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))).getUTCDay();
    expect(dow).not.toBe(0);
    expect(dow).not.toBe(6);

    const mondayMorning = parseDemoInstant("2026-11-16T02:00:00");
    const rolled = subtractBusinessDayHours(mondayMorning, 5);
    expect(demoDateKey(rolled)).toBe("2026-11-13");
  });

  it("flags Scott's slot as unreachable and names the reschedule step", () => {
    const scott = order("case-2-scott");
    const received = parseDemoInstant(caseReceivedAt(scott)!);
    const submitBy = submitByAt(parseDemoInstant(scott.scheduledAt!), scott.insurer);
    expect(submitBy.getTime()).toBeLessThan(received.getTime());
    expect(submitBy.getTime()).toBeLessThan(DEMO_NOW.getTime());
    expect(isSlotUnreachable(scott)).toBe(true);
    const row = toRow(scott);
    expect(row.flags.map((flag) => flag.id)).toContain("slot_unreachable");
    expect(nextStep(row).text).toBe(SLOT_UNREACHABLE_STEP);
  });

  it("leaves Sulu's later slot reachable", () => {
    const sulu = order("case-3-sulu");
    const received = parseDemoInstant(caseReceivedAt(sulu)!);
    const submitBy = submitByAt(parseDemoInstant(sulu.scheduledAt!), sulu.insurer);
    expect(submitBy.getTime()).toBeGreaterThan(received.getTime());
    expect(isSlotUnreachable(sulu)).toBe(false);
    expect(nextStep(toRow(sulu)).text).toBe("Send to Dr. McCoy");
  });
});

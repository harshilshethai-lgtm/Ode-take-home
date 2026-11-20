import { describe, expect, it } from "vitest";
import { SEED_ORDERS, DEMO_NOW } from "@/data/orders";
import { buildCaseRecord } from "@/domain/caseRecord";
import { memberIdFor } from "@/domain/memberId";
import { presentStatus } from "@/domain/priorAuth/render";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { isSubmitAtRisk } from "@/domain/timeRisk";
import { PARTITION_VIEWS, inView, toRow } from "@/lib/worklist";
import { fmtTableDate } from "@/lib/format";
import { parseDemoInstant } from "@/lib/demoClock";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("worklist fixes", () => {
  it("Kirk is submitted with a member ID from Epic", () => {
    const kirk = order("case-1-kirk");
    expect(kirk.status).toBe("submitted");
    const id = memberIdFor(kirk);
    expect(id).toMatchObject({ value: "FH-1701-1981", source: "epic" });
    const record = buildCaseRecord(kirk);
    const insurance = record.elements.find((item) => item.label === "Insurance");
    expect(insurance?.value).toContain("FH-1701-1981");
    expect(insurance?.origin).toBe("epic");
    expect(insurance?.cite).toBeUndefined();
    expect(insurance?.ranAt).toBe(DEMO_NOW.toISOString());
  });

  it("Scott is chase records, Thursday 11/12 at 9:00 AM, at risk, and submit is blocked", () => {
    const scott = order("case-2-scott");
    expect(presentStatus({ status: toOrderStatus(scott.status), reason: scott.reasonCode, linkedApproval: false }).label).toBe("Chase records");
    expect(scott.scheduledAt && fmtTableDate(parseDemoInstant(scott.scheduledAt))).toBe("Thu 11/12 · 9:00 AM");
    expect(scott.scheduleHandwritten).toBe(true);
    expect(scott.submissionBlocked).toBe(true);
    expect(isSubmitAtRisk({ scanAt: new Date(scott.scheduledAt!), insurer: scott.insurer, status: scott.status, now: DEMO_NOW })).toBe(true);
    const slot = buildCaseRecord(scott).elements.find((item) => item.label === "Scan slot");
    expect(slot?.handwritten).toBe(true);
    expect(slot?.origin).toBe("epic");
    expect(slot?.cite?.page).toBe(1);
  });

  it("Sulu returns to the provider with a draft and does not chase an X-ray", () => {
    const sulu = order("case-3-sulu");
    expect(presentStatus({ status: toOrderStatus(sulu.status), reason: sulu.reasonCode, linkedApproval: false }).label).toBe("Return to provider");
    expect(sulu.reason).toContain("Ask Dr. McCoy to order an X-ray");
    expect(sulu.reason).toContain("release the 11/16 slot");
    expect(sulu.otherIssues).toEqual([]);
    expect(sulu.reason.toLowerCase()).not.toContain("chase");
    expect(buildCaseRecord(sulu).missing).toEqual([]);
  });

  it("queue tabs partition every case", () => {
    const rows = SEED_ORDERS.map((item) => toRow(item));
    const seen = new Map<string, string>();
    for (const view of PARTITION_VIEWS) {
      for (const row of rows.filter((item) => inView(item, view))) {
        expect(seen.has(row.order.id), `${row.order.id} is in ${seen.get(row.order.id)} and ${view}`).toBe(false);
        seen.set(row.order.id, view);
      }
    }
    expect(seen.size).toBe(SEED_ORDERS.length);
    const open = rows.filter((row) => !row.closed).length;
    const closed = rows.filter((row) => inView(row, "closed")).length;
    expect(open + closed).toBe(SEED_ORDERS.length);
  });

  it("does not seed a status time after the demo clock", () => {
    for (const item of SEED_ORDERS) {
      expect(new Date(item.statusSince).getTime(), item.id).toBeLessThanOrEqual(DEMO_NOW.getTime());
    }
  });
});

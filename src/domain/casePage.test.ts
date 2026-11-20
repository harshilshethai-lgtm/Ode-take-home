import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { buildCaseRecord } from "@/domain/caseRecord";
import { getReviewPanel } from "@/domain/review/panel";
import { caseButtons, documentRows, orderFields, presentChecklist } from "./casePage";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("case page presentation", () => {
  it("Sisko merges the mismatch into one coverage failure and waits on criteria", () => {
    const item = order("case-18-sisko");
    const panel = getReviewPanel(item.id, "coordinator", item);
    const view = presentChecklist(item, panel);
    expect(view.summary).toBe("1 failed · 4 passed · 4 waiting on coverage");
    expect(caseButtons(item.reasonCode, "coordinator").map((button) => button.label)).toEqual(["Run eligibility", "Update registration"]);
    expect(caseButtons(item.reasonCode, "coordinator").some((button) => /fax/i.test(button.label))).toBe(false);
    const coverage = view.groups.find((group) => group.title === "Coverage");
    expect(coverage?.items).toHaveLength(1);
    expect(coverage?.items[0]).toMatchObject({ kind: "check", row: { result: "NOT_MET", found: "See summary" } });
    const consistency = view.groups.find((group) => group.title === "Consistency");
    expect(consistency?.items[0]).toMatchObject({ kind: "collapse", count: 4 });
    const criteria = view.groups.find((group) => group.title === "Insurer criteria");
    expect(criteria?.items[0]).toMatchObject({ kind: "waiting", count: 4 });
    const fields = orderFields(item, buildCaseRecord(item), panel);
    expect(fields.find((field) => field.label === "Insurance on order")?.value).toBe("Federation Health");
    expect(fields.find((field) => field.label === "Insurance on card")?.value).toBe("Bajoran Health Plan");
    expect(fields.find((field) => field.label === "Policy")).toMatchObject({ value: "Pending coverage check", muted: true });
    const docs = documentRows(buildCaseRecord(item), panel);
    expect(docs.map((row) => row.name)).toEqual(["EHR print", "Insurance card scan"]);
    expect(docs[1]?.description).toBe("Image only, read by OCR");
  });

  it("O'Brien keeps the side failure expanded", () => {
    const item = order("case-17-obrien");
    const panel = getReviewPanel(item.id, "coordinator", item);
    const view = presentChecklist(item, panel);
    expect(caseButtons(item.reasonCode, "coordinator").map((button) => button.label)).toEqual(["Notify ordering doctor", "Correction made"]);
    const consistency = view.groups.find((group) => group.title === "Consistency");
    expect(consistency?.items.every((row) => row.kind === "check")).toBe(true);
    const side = consistency?.items.find((row) => row.kind === "check" && row.row.id === "CO-1");
    expect(side).toMatchObject({ kind: "check", row: { result: "NOT_MET" } });
  });

  it("Kirk has no buttons and every group is a passing row", () => {
    const item = order("case-1-kirk");
    const panel = getReviewPanel(item.id, "coordinator", item);
    const view = presentChecklist(item, panel);
    expect(caseButtons(item.reasonCode, "coordinator")).toEqual([]);
    expect(view.summary).toBe("9 passed");
    expect(view.groups.every((group) => group.items.every((itemRow) => itemRow.kind !== "check" || itemRow.row.result === "MET"))).toBe(true);
    expect(view.groups.find((group) => group.title === "Consistency")?.items[0]?.kind).toBe("collapse");
    expect(view.groups.find((group) => group.title === "Insurer criteria")?.items[0]?.kind).toBe("collapse");
  });

  it("Sulu shows the nurse actions and leaves failing criteria open", () => {
    const item = order("case-3-sulu");
    const panel = getReviewPanel(item.id, "nurse", item);
    const view = presentChecklist(item, panel);
    expect(caseButtons(item.reasonCode, "coordinator")).toEqual([]);
    expect(caseButtons(item.reasonCode, "nurse").map((button) => button.label)).toEqual(["Approve for submission", "Cancel order"]);
    const criteria = view.groups.find((group) => group.title === "Insurer criteria");
    expect(criteria?.items.every((row) => row.kind === "check")).toBe(true);
    expect(criteria?.items.some((row) => row.kind === "check" && row.row.result === "NOT_MET")).toBe(true);
  });
});

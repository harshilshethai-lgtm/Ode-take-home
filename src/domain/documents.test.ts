import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { buildCaseRecord } from "./caseRecord";

describe("document bundles", () => {
  it("Kirk criteria cite at least three files", () => {
    const record = buildCaseRecord(SEED_ORDERS.find((order) => order.id === "case-1-kirk")!);
    const names = new Set(
      record.criteria.flatMap((row) => row.cites.map((cite) => record.documents.find((doc) => doc.id === cite.docId)?.shortName)),
    );
    expect(names.size).toBeGreaterThanOrEqual(3);
    expect(names.has("Epic note")).toBe(true);
    expect(names.has("Starbase PT")).toBe(true);
    expect(record.documents.some((doc) => doc.originalFile === "kirk")).toBe(true);
  });
});

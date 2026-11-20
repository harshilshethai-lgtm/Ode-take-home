import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { buildCaseRecord, sentences, words } from "./caseRecord";

describe("case record", () => {
  it("Kirk is cited from the packet and ready to submit", () => {
    const record = buildCaseRecord(SEED_ORDERS.find((o) => o.id === "case-1-kirk")!);
    expect(record.docId).toBe("ORD-58213");
    expect(record.primaryLabel).toBeNull();
    expect(words(record.summary)).toBeLessThanOrEqual(40);
    expect(sentences(record.summary)).toBeLessThanOrEqual(2);
    expect(record.criteria.map((c) => c.status)).toEqual(["met", "met", "met", "met"]);
    expect(record.elements.length).toBeLessThanOrEqual(8);
    expect(record.documents.map((d) => d.file)).toEqual(["kirk"]);
    for (const el of record.elements) {
      if (el.label === "Policy") continue;
      expect(el.cite ?? el.origin, el.label).toBeTruthy();
    }
    expect(record.extracted.every((r) => r.cite.quote.length > 0)).toBe(true);
  });

  it("Scott and Sulu open their own packets, never the policy PDF", () => {
    const scott = buildCaseRecord(SEED_ORDERS.find((o) => o.id === "case-2-scott")!);
    const sulu = buildCaseRecord(SEED_ORDERS.find((o) => o.id === "case-3-sulu")!);
    expect(scott.documents.map((d) => d.file)).toEqual(["scott"]);
    expect(sulu.documents.map((d) => d.file)).toEqual(["sulu"]);
    expect(scott.primaryLabel).toBe("Request records");
    expect(sulu.primaryLabel).toBe("Review");
    expect(scott.criteria.map((c) => c.status)).toEqual(["met", "unknown", "met", "unknown"]);
    expect(sulu.criteria.map((c) => c.status)).toEqual(["not_met", "not_met", "unknown", "unknown"]);
    expect(scott.order.status).toBe("needs_admin_review");
    expect(scott.order.reasonCode).toBe("MISSING_DOCUMENTS");
    expect(sulu.order.status).toBe("needs_clinical_review");
    expect(sulu.order.reasonCode).toBe("CRITERIA_NOT_MET");
  });

  it("every case opens a different packet", () => {
    const files = new Set<string>();
    expect(SEED_ORDERS).toHaveLength(23);
    for (const order of SEED_ORDERS) {
      const docs = buildCaseRecord(order).documents;
      expect(docs, order.id).toHaveLength(1);
      expect(files.has(docs[0].file), docs[0].file).toBe(false);
      files.add(docs[0].file);
    }
  });

  it("keeps every summary inside the copy budget", () => {
    for (const order of SEED_ORDERS) {
      const record = buildCaseRecord(order);
      expect(words(record.summary), order.id).toBeLessThanOrEqual(40);
      expect(sentences(record.summary), order.id).toBeLessThanOrEqual(2);
      expect(record.elements.length, order.id).toBeLessThanOrEqual(8);
      expect(record.flags.length, order.id).toBeLessThanOrEqual(2);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { RESULT_PRESENTATION } from "@/components/ui/result-pill";
import type { CheckResult } from "./types";
import { assertEvaluationAfterReceipt, checksCardVisible, checksSummary, ensureCoverage, getReviewPanel, isPastCoverage } from "./panel";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("review panel", () => {
  it("O'Brien needs a side correction, with every MSK-207 criterion checked for the right knee", () => {
    const panel = getReviewPanel("case-17-obrien", "coordinator");
    expect(panel.headline).toBe("Request says left knee; every record says right");
    expect(panel.scan.deadline).toMatch(/^Submit by |^Past due /);
    expect(panel.context.constraint).toBe("Denied requests can't be amended");
    expect(panel.context.channel).toBe("portal");
    expect(checksSummary(panel.checks.summary)).toBe("1 failed · 4 passed");
    expect(panel.checks.criteria.assumption).toBe("right knee");
    expect(panel.checks.criteria.rows.filter((row) => !row.id.startsWith("waiver:"))).toHaveLength(4);
    expect(panel.checks.criteria.rows.some((row) => row.label === "Same side throughout")).toBe(false);
    expect(panel.checks.consistency.find((row) => row.id === "CO-1")?.result).toBe("NOT_MET");
    expect(panel.toResolve[0]?.text).toBe("Correct the order to the right knee (M25.561)");
    expect(panel.toResolve.map((item) => item.action?.label)).toContain("Notify ordering doctor");
    expect(panel.checks.evaluatedAt >= (panel.checks.receivedAt ?? "")).toBe(true);
    expect(new Date(panel.checks.evaluatedAt).getTime()).toBeGreaterThanOrEqual(new Date("2026-11-10T15:02:00.000Z").getTime());
    expect(panel.documentNotes.some((row) => row.id === "PP-1" && row.result === "FIXED")).toBe(true);
  });

  it("rejects an evaluation time earlier than the fax", () => {
    expect(() => assertEvaluationAfterReceipt("2026-11-10T14:00:00.000Z", ["2026-11-10T15:02:00.000Z"])).toThrow(/earlier than an attached document/);
  });

  it("Kirk is ready, with nothing to resolve and the evidence folded away", () => {
    const panel = getReviewPanel("case-1-kirk", "coordinator");
    expect(panel.headline).toBe("Meets all 4 criteria; ready to send via API");
    expect(panel.toResolve).toEqual([]);
    expect(checksSummary(panel.checks.summary)).toBe("4 passed");
    expect(panel.evidence).toEqual([]);
    expect(checksCardVisible(panel)).toBe(true);
  });

  it("Scott is waiting on the PT notes and two criteria are unclear", () => {
    const panel = getReviewPanel("case-2-scott", "coordinator");
    expect(panel.headline).toBe("Waiting on PT notes (page 4) from Utopia Planitia Rehab");
    expect(panel.toResolve[0]?.text).toContain("Request resend");
    expect(panel.toResolve[0]?.contact).toBe("Utopia Planitia Rehab");
    expect(panel.toResolve.map((item) => item.action?.label)).toContain("Resend request");
    expect(checksSummary(panel.checks.summary)).toBe("2 unclear · 2 passed");
    const unclear = panel.checks.criteria.rows.filter((row) => row.result === "UNCLEAR").map((row) => row.id);
    expect(unclear).toEqual(expect.arrayContaining(["conservative_care", "no_recent_mri"]));
  });

  it("Sulu returns to the ordering doctor with a draft and no X-ray chase", () => {
    const coordinator = getReviewPanel("case-3-sulu", "coordinator");
    expect(coordinator.headline).toContain("3 weeks of pain and 1 week of PT");
    expect(coordinator.headline).toContain("order an X-ray");
    expect(coordinator.headline).not.toMatch(/chase/i);
    expect(checksSummary(coordinator.checks.summary)).toBe("3 failed · 1 unclear");
    expect(coordinator.toResolve.map((item) => item.action?.label)).toEqual(expect.arrayContaining(["Send draft", "Release slot"]));
    expect(coordinator.toResolve.every((item) => item.readOnly)).toBe(false);

    const nurse = getReviewPanel("case-3-sulu", "nurse");
    expect(nurse.toResolve.every((item) => item.readOnly)).toBe(true);
    expect(nurse.toResolve[0]?.owner).toBe("coordinator");
  });

  it("follows the live status after a nurse approves Sulu", () => {
    const panel = getReviewPanel("case-3-sulu", "nurse", {
      ...order("case-3-sulu"),
      status: "needs_admin_review",
      reasonCode: "PORTAL_UPLOAD",
      detail: { n: 4, insurer: "Andorian Life", k: 1 },
      reason: "Symptoms documented, sending",
    });
    expect(panel.headline).toBe("Approved for submission; upload via portal");
    expect(panel.toResolve[0]?.text).toBe("Record the portal reference once it's uploaded");
    expect(panel.toResolve[0]?.readOnly).toBe(true);
    expect(panel.toResolve[0]?.owner).toBe("coordinator");
  });

  it("Janeway shows the waiver and no resolve card", () => {
    const panel = getReviewPanel("case-4-janeway", "nurse");
    expect(panel.urgent).toBe(true);
    expect(panel.toResolve).toEqual([]);
    expect(checksSummary(panel.checks.summary)).toBe("3 waived · 1 passed");
    expect(panel.checks.criteria.rows.some((row) => row.label === "Waiver: cauda equina symptoms")).toBe(true);
  });

  it("Nog fails the patient check and asks for his own PT records", () => {
    const panel = getReviewPanel("case-15-nog", "coordinator");
    expect(panel.headline).toBe("Page 3 belongs to another patient; removed from the packet");
    expect(panel.toResolve[0]?.text).toBe("Request Nog's PT records");
    expect(panel.checks.consistency.find((row) => row.id === "CO-4")?.result).toBe("NOT_MET");
    expect(panel.checks.summary.failed).toBe(1);
    expect(panel.documents.some((doc) => doc.status === "QUARANTINED")).toBe(true);
  });

  it("Troi hides checks and still shows coverage", () => {
    const panel = getReviewPanel("case-11-troi", "coordinator");
    expect(panel.headline).toBe("No approval needed: outpatient CT not on Bajoran's list");
    expect(panel.toResolve).toEqual([]);
    expect(checksCardVisible(panel)).toBe(false);
    expect(panel.coverage.map((row) => row.id)).toEqual(["CV-1", "CV-2"]);
  });

  it("Odo hides checks and asks the fax sender to resend", () => {
    const panel = getReviewPanel("case-20-odo", "coordinator");
    expect(panel.headline).toBe("Couldn't read this fax: all 4 pages blank");
    expect(checksCardVisible(panel)).toBe(false);
    expect(panel.toResolve[0]?.action?.label).toBe("Request a clean copy");
    expect(panel.toResolve[0]?.contact).toContain("Promenade Urgent Care");
    expect(panel.toResolve[0]?.contact).toContain("555-0148");
    expect(panel.documents[0]?.type).toBe("Blank fax");
  });

  it("never reports that no checks ran once coverage has been passed", () => {
    for (const item of SEED_ORDERS) {
      const panel = getReviewPanel(item.id, "coordinator");
      expect(JSON.stringify(panel), item.id).not.toContain("No checks run");
      if (!isPastCoverage(panel.status, item.blockingChecks ?? [], item.reasonCode)) continue;
      expect(panel.coverage.length, item.id).toBeGreaterThan(0);
      expect(panel.coverage.some((row) => row.found.includes("pipeline error")), item.id).toBe(false);
    }
  });

  it("says so when coverage never ran on an order that is past that step", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = ensureCoverage("SUBMITTED", [], [], "case-x");
    expect(rows[0]?.found).toBe("Not run: pipeline error");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("keeps evidence quotes under 12 words", () => {
    for (const item of SEED_ORDERS) {
      const panel = getReviewPanel(item.id, "nurse");
      for (const block of panel.evidence) {
        for (const row of block.rows) {
          expect(row.quote.trim().split(/\s+/).length, `${item.id} ${row.quote}`).toBeLessThan(12);
        }
      }
    }
  });

  it("Sisko's deadline skips the weekend and the office-note X-ray counts", () => {
    const panel = getReviewPanel("case-18-sisko", "coordinator", order("case-18-sisko"));
    expect(panel.scan.deadline).toMatch(/^Submit by |^Past due /);
    const xray = panel.checks.criteria.rows.find((row) => row.id === "prior_xray");
    expect(xray?.result).toBe("MET");
    expect(xray?.found ?? "").not.toMatch(/Not checked/);
    expect(panel.checks.evaluatedAt >= (panel.checks.receivedAt ?? "")).toBe(true);
  });

  it("gives every result a text label", () => {
    const results = Object.keys(RESULT_PRESENTATION) as CheckResult[];
    expect(results).toEqual(["MET", "NOT_MET", "UNCLEAR", "WAIVED", "EXCEPTION_MET", "FIXED"]);
    for (const result of results) expect(RESULT_PRESENTATION[result].label.length).toBeGreaterThan(0);
  });
});

describe("evaluation follows the documents", () => {
  it("holds for every attached packet", () => {
    for (const item of SEED_ORDERS) {
      const panel = getReviewPanel(item.id, "coordinator", order(item.id));
      const attached = panel.documents.filter((doc) => doc.status === "ATTACHED");
      if (!panel.checks.evaluatedAt || attached.length === 0 || !panel.checks.receivedAt) continue;
      assertEvaluationAfterReceipt(panel.checks.evaluatedAt, [panel.checks.receivedAt]);
    }
  });
});

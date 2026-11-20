import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import kirk from "@fixtures/case-1-kirk/expected.json";
import rad114 from "@fixtures/rules/RAD-114.json";
import { kirkCriteria, kirkStatus, SEED_ORDERS, DEMO_NOW } from "@/data/orders";
import { decide, type CriterionOutcome } from "./decision";
import { STATUSES } from "./statuses";
import { computeTimeRisk } from "./timeRisk";
import { toRow } from "@/lib/worklist";

const root = resolve(__dirname, "../..");

describe("Case 1 · Kirk · lumbar MRI · Federation Health RAD-114", () => {
  it("fixture files exist", () => {
    for (const f of [kirk.input.file, kirk.answer_key_file, rad114.source.document]) {
      expect(existsSync(resolve(root, f)), f).toBe(true);
    }
  });

  it("order matches the rule's match fields", () => {
    expect(rad114.match.insurer).toBe(kirk.order.insurer);
    expect(rad114.match.cpt).toContain(kirk.order.cpt);
    expect(rad114.match.setting).toContain(kirk.order.setting);
    expect(rad114.approval_required).toBe(true);
    expect(kirk.expected.approvalNeeded).toBe(true);
  });

  it("answer key has one result per RAD-114 criterion, in order", () => {
    expect(kirk.expected.criteria.map((c) => c.id)).toEqual(rad114.criteria.all.map((c) => c.id));
  });

  it("every criterion is Met and carries a page citation inside the 3-page packet", () => {
    for (const c of kirk.expected.criteria) {
      expect(c.result, c.id).toBe("met");
      expect(c.citations.length, c.id).toBeGreaterThan(0);
      for (const cite of c.citations) {
        expect(cite.page).toBeGreaterThanOrEqual(1);
        expect(cite.page).toBeLessThanOrEqual(kirk.input.pages.length);
        expect(cite.quote.length).toBeGreaterThan(0);
      }
    }
  });

  it("no red flags, nothing missing, packet complete", () => {
    expect(kirk.expected.redFlags.found).toEqual([]);
    expect(kirk.expected.missingItems).toEqual([]);
    expect(kirk.expected.packetComplete).toBe(true);
  });

  it("decision logic routes the answer key's criteria to Ready to submit (no nurse)", () => {
    expect(kirkStatus).toBe("ready_to_submit");
    expect(kirkStatus).toBe(kirk.expected.status);
    expect(STATUSES[kirkStatus].group).toBe("automated");
  });

  it("submits via the API channel with the three attachments the policy asks for", () => {
    expect(kirk.expected.channel).toBe(rad114.submission.channel);
    expect(kirk.expected.attachments.map((a) => a.name)).toEqual([
      "Progress note 11/09",
      "PT discharge summary",
      "X-ray report 10/02",
    ]);
  });

  it("appears on the worklist as one system-owned, on-track line", () => {
    const rows = SEED_ORDERS.filter((o) => o.caseNumber === 1).map((o) => toRow(o));
    expect(rows).toHaveLength(1);
    expect(rows[0].order.status).toBe("ready_to_submit");
    expect(rows[0].ownerRole).toBe("system");
    expect(rows[0].risk).toBe(kirk.expected.timeRisk);
  });
});

describe("Decision logic (PRD §Evaluating)", () => {
  const ok = (id: string): CriterionOutcome => ({ id, result: "met", failClass: "documents", confidence: 0.95 });
  const base = { failedConsistencyChecks: [], confidenceThreshold: 0.85 };

  it("consistency failure wins over everything", () => {
    expect(decide({ ...base, failedConsistencyChecks: ["CO-1"], criteria: kirkCriteria })).toBe("needs_correction");
  });

  it("Not met + clinical → Clinical review, even if documents are also missing", () => {
    const criteria: CriterionOutcome[] = [
      { id: "2a", result: "not_met", failClass: "clinical", confidence: 0.95 },
      { id: "2b", result: "unclear", failClass: "documents", confidence: 0.5 },
    ];
    expect(decide({ ...base, criteria })).toBe("clinical_review");
  });

  it("Unclear never counts as Met → Awaiting documents", () => {
    expect(decide({ ...base, criteria: [ok("2a"), { ...ok("2b"), result: "unclear" }] })).toBe("awaiting_documents");
  });

  it("Waived and Exception met pass", () => {
    expect(
      decide({ ...base, criteria: [{ ...ok("2a"), result: "waived" }, { ...ok("2d"), result: "exception_met" }] }),
    ).toBe("ready_to_submit");
  });

  it("a passing result below the confidence threshold counts as Unclear", () => {
    expect(decide({ ...base, criteria: [{ ...ok("2a"), confidence: 0.6 }] })).toBe("awaiting_documents");
  });
});

describe("Time-risk policy", () => {
  const now = DEMO_NOW;
  const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 36e5);

  it("on track when far from the scan", () => {
    expect(computeTimeRisk({ scanAt: at(24 * 9), insurer: "Federation Health", status: "ready_to_submit", now })).toBe(
      "on_track",
    );
  });

  it("at risk inside turnaround + 1 day", () => {
    expect(computeTimeRisk({ scanAt: at(40), insurer: "Federation Health", status: "needs_correction", now })).toBe(
      "at_risk",
    );
  });

  it("slot at risk when the insurer can't answer before the scan", () => {
    expect(computeTimeRisk({ scanAt: at(60), insurer: "Ferengi Benefit Group", status: "ready_to_submit", now })).toBe(
      "slot_at_risk",
    );
  });

  it("closed orders carry no risk", () => {
    expect(computeTimeRisk({ scanAt: at(2), insurer: "Federation Health", status: "approved", now })).toBe("none");
  });
});

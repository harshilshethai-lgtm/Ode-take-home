import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { actionStatusLabel } from "@/domain/priorAuth/render";
import { pipelineDurationMs, planInboundFax } from "./inboundFax";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("inbound fax", () => {
  it("finishes Scott in under 10 seconds and logs the match", () => {
    const plan = planInboundFax(order("case-2-scott"));
    expect(plan.completes).toBe(true);
    expect(pipelineDurationMs(plan)).toBeLessThan(10_000);
    const reasons = plan.steps.flatMap((step) => step.patch.pipelineActivity.map((entry) => entry.reason));
    expect(reasons.some((reason) => reason.includes("DOB 06/11/1979") && reason.includes("HH-0017042"))).toBe(true);
    expect(reasons.some((reason) => reason.includes("39 days"))).toBe(true);
    expect(reasons.some((reason) => reason.includes("Epic"))).toBe(true);
    const last = plan.steps.at(-1)?.patch;
    expect(last?.statusLabel).toBe("Ready · upload to Ferengi portal");
    expect(last?.faxAttached).toBe(true);
    expect(last?.reasonCode).toBe("PORTAL_UPLOAD");
  });

  it("times a case with no second fax out to admin review", () => {
    const plan = planInboundFax(order("case-1-kirk"));
    expect(plan.completes).toBe(false);
    expect(plan.timeout.status).toBe("needs_admin_review");
    expect(plan.timeout.reasonText).toBe("Pipeline timed out before a decision.");
  });

  it("labels a failed portal upload as resubmit", () => {
    expect(actionStatusLabel("SUBMISSION_FAILED")).toBe("Resubmit");
    expect(order("case-27-chekov").reason).toContain("upload failed: file > 10MB");
    expect(order("case-27-chekov").reason).toContain("under 10MB");
    expect(order("case-26-uhura").reasonCode).toBe("APPEAL");
    expect(order("case-26-uhura").status).toBe("submitted");
  });
});
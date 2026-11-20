import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { projectCase, statusLabelFor } from "@/domain/caseStatus";
import { guidanceFor } from "@/domain/guidance";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { presentStatus } from "@/domain/priorAuth/render";
import { AuthState, applyReason, createOrder, readAudits, transitionOrder } from "@/domain/priorAuth/store";
import type { ApprovalInput } from "@/domain/priorAuth/types";
import { PARTITION_VIEWS, inView, nextStep, toRow } from "@/lib/worklist";

describe("one status machine", () => {
  it("walks every seeded case from the same status, badge, tab, and activity log", () => {
    for (const order of SEED_ORDERS) {
      const view = projectCase(order);
      const row = toRow(order);
      const badge = presentStatus({
        status: toOrderStatus(order.status),
        reason: order.reasonCode,
        linkedApproval: order.linkedApproval === true,
      }).label;
      expect(view.label, order.id).toBe(badge);
      expect(view.label, order.id).toBe(statusLabelFor(order));
      expect(view.tab, order.id).toBe(PARTITION_VIEWS.find((tab) => inView(row, tab)));
      expect(view.nextStep, order.id).toBe(nextStep(row).text);
      expect(view.reason, order.id).toBe(guidanceFor(order).reason);

      const changes = view.activity.filter((entry) => entry.from && entry.to);
      for (const entry of changes) expect(entry.from, order.id).not.toBe(entry.to);
      expect(new Set(changes.map((entry) => `${entry.from}→${entry.to}`)).size, order.id).toBe(changes.length);

      const state = new AuthState();
      const created = createOrder(state, { id: order.id, status: "PROCESSING", step: order.step ?? "INTAKE", now: new Date(order.statusSince) });
      if (order.status === "processing") {
        expect(changes, order.id).toHaveLength(0);
        expect(readAudits(state, { orderId: order.id }), order.id).toHaveLength(0);
        expect(created.status).toBe("PROCESSING");
        continue;
      }

      expect(changes, order.id).toHaveLength(1);
      expect(changes[0]?.to, order.id).toBe(view.label);
      const target = toOrderStatus(order.status);
      const approval: ApprovalInput | undefined =
        target === "APPROVED"
          ? {
              number: String(order.detail.number ?? ""),
              cpt: String(order.detail.cpt ?? order.cpt ?? ""),
              validFrom: String(order.detail.validFrom ?? ""),
              validTo: String(order.detail.validTo ?? ""),
              linked: order.reasonCode === "LINKED_EXISTING",
            }
          : undefined;
      const moved = transitionOrder(state, order.id, target, {
        actor: { kind: "system" },
        expectedVersion: created.statusVersion,
        reason: order.reasonCode,
        detail: order.detail,
        approval,
        now: new Date(order.statusSince),
      });
      expect(moved.status, order.id).toBe(target);
      const audits = readAudits(state, { orderId: order.id });
      expect(audits, order.id).toHaveLength(1);
      expect(audits[0]?.fromStatus, order.id).not.toBe(audits[0]?.toStatus);
      expect(audits[0]?.toStatus, order.id).toBe(target);
      expect(presentStatus({ status: moved.status, reason: moved.reason, linkedApproval: moved.linkedApproval }).label, order.id).toBe(view.label);
    }
  });

  it("does not write an activity event when the reason changes and the status stays", () => {
    const state = new AuthState();
    const created = createOrder(state, { status: "PROCESSING", step: "INTAKE" });
    transitionOrder(state, created.id, "SUBMITTED", {
      actor: { kind: "system" },
      expectedVersion: 1,
      reason: "INITIAL_REQUEST",
      detail: { insurer: "Federation Health", channel: "API", date: "Nov 9", ref: "FH-1", time: "3:45 PM" },
    });
    const before = readAudits(state, { orderId: created.id }).length;
    applyReason(state, created.id, {
      actor: { kind: "system" },
      expectedVersion: 2,
      reason: "AWAITING_DECISION",
      detail: { insurer: "Federation Health", channel: "API", date: "Nov 9", ref: "FH-1", time: "4:00 PM", normalized: "In review" },
    });
    const audits = readAudits(state, { orderId: created.id });
    expect(audits).toHaveLength(before);
    expect(audits.every((row) => row.fromStatus !== row.toStatus)).toBe(true);
  });
});

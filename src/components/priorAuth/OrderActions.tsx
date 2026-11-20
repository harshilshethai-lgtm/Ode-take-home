import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { actionsFor } from "@/domain/priorAuth/actions";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { renderActions, type RenderedAction } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { OrderSnapshot, UserRole } from "@/domain/priorAuth/types";
import type { Order, Person } from "@/domain/types";
import type { StatusId } from "@/domain/statuses";

export interface AppliedStatus {
  label: string;
  status?: StatusId;
  reason?: string;
  confirmOnly?: boolean;
  linkedApproval?: boolean;
}

/** Action buttons for the signed-in role. Each status change goes through the transition engine. */
export function OrderActions({
  order,
  role,
  actorId,
  fixableGaps,
  demotePrimary,
  onApplied,
}: {
  order: Order;
  role: Person["role"];
  actorId: string;
  fixableGaps: boolean;
  demotePrimary?: boolean;
  onApplied: (result: AppliedStatus) => void;
}) {
  const [portalReference, setPortalReference] = useState("");
  const [note, setNote] = useState("");
  const snapshot = toSnapshot(order, fixableGaps);
  const viewer = role as UserRole;
  const defined = actionsFor(snapshot, viewer);
  const actions = renderActions(snapshot, viewer, { note, portalReference });
  if (actions.length === 0) return null;

  const needsPortal = defined.some((action) => action.requires.includes("portalReference"));
  const needsNote = defined.some((action) => action.requires.includes("note"));

  function run(action: RenderedAction) {
    if (action.disabled) return;
    const definedAction = defined.find((item) => item.id === action.id);
    const target = action.to;
    if (!target || !definedAction) {
      const state = new AuthState();
      recordSideEffect(state, sideEffect(action.id, order.id));
      onApplied({ label: action.label });
      return;
    }
    const state = new AuthState();
    const created = createOrder(state, {
      status: snapshot.status,
      channel: snapshot.channel,
      reason: snapshot.reason,
      step: snapshot.step,
      detail: snapshot.detail,
      blockingChecks: snapshot.blockingChecks,
      fixableGaps: snapshot.fixableGaps,
      confirmOnly: snapshot.confirmOnly,
      linkedApproval: snapshot.linkedApproval,
    });
    const next = transitionOrder(state, created.id, target, {
      actor: { kind: "user", id: actorId, role: viewer, permissions: ["cancel"] },
      expectedVersion: created.statusVersion,
      reason: definedAction.reason,
      step: definedAction.step ?? null,
      detail: snapshot.detail,
      note: note.trim(),
      portalReference: portalReference.trim(),
      trigger: definedAction.trigger,
      checkIds: snapshot.blockingChecks,
    });
    const reason = readAudits(state, { orderId: created.id }).at(-1)?.reason ?? action.label;
    onApplied({
      label: action.label,
      status: toStatusId(next.status),
      reason,
      confirmOnly: next.confirmOnly,
      linkedApproval: next.linkedApproval,
    });
  }

  return (
    <div className="flex items-center gap-2">
      {needsPortal && (
        <input
          value={portalReference}
          onChange={(e) => setPortalReference(e.target.value)}
          placeholder="Portal reference"
          aria-label="Portal reference"
          className="h-7 w-36 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {needsNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Review note"
          aria-label="Review note"
          className="h-7 w-40 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {actions.map((action, index) => (
        <Tip key={action.id} content={action.disabledReason ?? action.label}>
          <span>
            <Button variant={index === 0 && !demotePrimary ? "default" : "secondary"} disabled={action.disabled} onClick={() => run(action)}>
              {action.label}
            </Button>
          </span>
        </Tip>
      ))}
    </div>
  );
}

function toSnapshot(order: Order, fixableGaps: boolean): OrderSnapshot {
  return {
    id: order.id,
    status: toOrderStatus(order.status),
    statusVersion: 1,
    channel: order.channel,
    reason: order.reasonCode,
    step: order.step,
    detail: order.detail,
    otherIssues: order.otherIssues,
    missingDocumentsEntries: 0,
    resumeStep: null,
    submissionAttempts: 0,
    confirmOnly: order.reasonCode === "CONFIRM_AFTER_FIX",
    linkedApproval: order.linkedApproval === true,
    approval: null,
    blockingChecks: order.blockingChecks ?? [],
    fixableGaps,
    scanCompleted: false,
    createdAt: order.statusSince,
  };
}

function sideEffect(id: string, orderId: string) {
  if (id === "notify_ordering_doctor") return { type: "notify_ordering_doctor" as const, orderId };
  if (id === "message_ordering_doctor") return { type: "message_ordering_doctor" as const, orderId };
  if (id === "open_packet") return { type: "open_packet" as const, orderId };
  return { type: "resend_request" as const, orderId };
}

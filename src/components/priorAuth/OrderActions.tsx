import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { actionsFor } from "@/domain/priorAuth/actions";
import { correctionDestination } from "@/domain/priorAuth/catalog";
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
  onApplied,
}: {
  order: Order;
  role: Person["role"];
  actorId: string;
  fixableGaps: boolean;
  onApplied: (result: AppliedStatus) => void;
}) {
  const [portalReference, setPortalReference] = useState("");
  const [note, setNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const snapshot = toSnapshot(order, fixableGaps);
  const viewer = role as UserRole;
  const defined = actionsFor(snapshot, viewer);
  const actions = renderActions(snapshot, viewer, { note, portalReference, cancelReason });
  if (actions.length === 0) return null;

  const needsPortal = defined.some((action) => action.requires.includes("portalReference"));
  const needsNote = defined.some((action) => action.requires.includes("note"));
  const needsCancel = defined.some((action) => action.requires.includes("cancelReason"));

  function run(action: RenderedAction) {
    if (action.disabled) return;
    const target = action.id === "correction_made" ? correctionDestination(snapshot.blockingChecks) : action.to;
    if (!target) {
      const state = new AuthState();
      recordSideEffect(state, sideEffect(action.id, order.id));
      onApplied({ label: action.label });
      return;
    }
    const state = new AuthState();
    const created = createOrder(state, {
      status: snapshot.status,
      channel: snapshot.channel,
      blockingChecks: snapshot.blockingChecks,
      fixableGaps: snapshot.fixableGaps,
      confirmOnly: snapshot.confirmOnly,
      linkedApproval: snapshot.linkedApproval,
    });
    const next = transitionOrder(state, created.id, target, {
      actor: { kind: "user", id: actorId, role: viewer, permissions: ["cancel"] },
      expectedVersion: created.statusVersion,
      reason: cancelReason.trim() || note.trim() || action.label,
      note: note.trim(),
      portalReference: portalReference.trim(),
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
      {needsCancel && (
        <input
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Cancel reason"
          aria-label="Cancel reason"
          className="h-7 w-36 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {actions.map((action, index) => (
        <Tip key={action.id} content={action.disabledReason ?? action.label}>
          <span>
            <Button variant={index === 0 ? "default" : "secondary"} disabled={action.disabled} onClick={() => run(action)}>
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
    blockingChecks: order.blockingChecks ?? [],
    fixableGaps,
    awaitingDocumentsEntries: 0,
    confirmOnly: order.confirmOnly === true,
    linkedApproval: order.linkedApproval === true,
    approval: null,
    createdAt: order.statusSince,
  };
}

function sideEffect(id: string, orderId: string) {
  if (id === "notify_ordering_doctor") return { type: "notify_ordering_doctor" as const, orderId };
  if (id === "message_ordering_doctor") return { type: "message_ordering_doctor" as const, orderId };
  if (id === "open_packet") return { type: "open_packet" as const, orderId };
  return { type: "resend_request" as const, orderId };
}

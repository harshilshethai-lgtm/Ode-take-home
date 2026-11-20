import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { Button } from "@/components/ui/button";
import { CheckedAgainst } from "@/components/evaluation/CheckedAgainst";
import { RulesChangedBanner } from "@/components/evaluation/RulesChangedBanner";
import { CitationChip } from "@/components/ui/citation-chip";
import { ResultPill } from "@/components/ui/result-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { actionsFor, type StatusAction } from "@/domain/priorAuth/actions";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { renderActions } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { Effect, UserRole } from "@/domain/priorAuth/types";
import { checksCardVisible, checksSummary } from "@/domain/review/panel";
import type { CheckRow, ReviewPanel as ReviewModel } from "@/domain/review/types";
import type { Order } from "@/domain/types";
import type { StatusId } from "@/domain/statuses";
import { cn } from "@/lib/cn";
import { PEOPLE_BY_ID } from "@/data/people";
import { fmtTableDate } from "@/lib/format";
import { useOrderCheck } from "@/lib/useOrderCheck";

export interface AppliedReview {
  label: string;
  status?: StatusId;
  reason?: string;
  confirmOnly?: boolean;
  linkedApproval?: boolean;
}

interface OpenPage {
  docId: string;
  page: number;
  quote?: string;
}

const BORDER: Record<string, string> = {
  system: "border-status-system",
  coordinator: "border-status-coordinator",
  nurse: "border-status-nurse",
  approved: "border-status-approved",
  denied: "border-status-denied",
  cancelled: "border-fg-3",
};

export function ReviewPanelView({
  panel,
  order,
  role,
  actorId,
  onOpen,
  onApplied,
}: {
  panel: ReviewModel;
  order: Order;
  role: UserRole;
  actorId: string;
  onOpen: (cite: OpenPage) => void;
  onApplied: (result: AppliedReview) => void;
}) {
  const tone = statusTone(panel);
  const context = contextLine(panel);
  const showChecks = checksCardVisible(panel);
  const check = useOrderCheck(order.orderNumber);
  const lockedDoc = (docId?: string) => panel.documents.some((doc) => doc.id === docId && doc.status === "QUARANTINED");
  return (
    <div className="space-y-6">
      <section data-review="banner" className={cn("rounded-lg border bg-panel p-4", BORDER[tone] ?? "border-line")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusPill status={toStatusId(panel.status)} channel={panel.orderChannel} confirmOnly={panel.confirmOnly} linked={panel.linked} />
              {panel.urgent && <span className="text-caption text-bad">Urgent</span>}
            </div>
            <div className="mt-2 text-emph text-fg">{panel.headline}</div>
            {context && <div className="mt-1 text-caption text-fg-2">{context}</div>}
          </div>
          <div className="shrink-0 text-right">
            {panel.scan.at && <div className="tabular text-caption text-fg">Scan {fmtTableDate(new Date(panel.scan.at))}</div>}
            {panel.scan.deadline && (
              <div
                className={cn(
                  "tabular text-caption",
                  panel.scan.risk === "slot_at_risk" && "text-bad",
                  panel.scan.risk === "at_risk" && "text-warning",
                  panel.scan.risk === "on_track" && "text-fg-2",
                )}
              >
                {panel.scan.deadline}
              </div>
            )}
          </div>
        </div>
      </section>

      {panel.toResolve.length > 0 && (
        <Card title="To resolve" summary={String(panel.toResolve.length)}>
          <ResolveList panel={panel} order={order} role={role} actorId={actorId} onApplied={onApplied} />
        </Card>
      )}

      {showChecks && check.staleness && (
        <RulesChangedBanner staleness={check.staleness} onRerun={() => check.recheck(PEOPLE_BY_ID[actorId]?.name ?? "System")} />
      )}

      {showChecks && (
        <Card title="Checks" summary={checksSummary(panel.checks.summary)}>
          <Group title="Consistency" rows={panel.checks.consistency} onOpen={onOpen} />
          <Group
            title={criteriaTitle(panel)}
            rows={panel.checks.criteria.rows}
            onOpen={onOpen}
          />
          {panel.checks.evaluatedAt && (
            <div className="mt-2 text-caption text-fg-2">
              Evaluated {fmtTableDate(new Date(panel.checks.evaluatedAt))} ·{" "}
              {check.evaluation?.rulesSnapshot ? (
                <CheckedAgainst evaluation={check.evaluation} />
              ) : (
                <>against {panel.checks.criteria.policyId} rev {panel.checks.criteria.rev}</>
              )}
              {panel.checks.receivedAt && (
                <>
                  {" "}
                  · {panel.checks.receivedKind === "fax" ? "Fax received" : "Received"} {fmtTableDate(new Date(panel.checks.receivedAt))}
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {panel.evidence.length > 0 ? (
        <Card title="Evidence" summary={String(panel.evidence.length)}>
          {panel.evidence.map((block) => (
            <div key={block.forCheckId} className="mt-2">
              <div className="text-caption text-fg-2">Evidence for {block.fact}</div>
              {block.rows.map((row) => (
                <ReviewRow
                  key={`${block.forCheckId}-${row.page}-${row.source}`}
                  lead={row.source}
                  label={row.value}
                  value={`“${row.quote}”`}
                  labelDanger={row.conflict}
                  page={row.page}
                  quote={row.quote}
                  docId={row.docId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </Card>
      ) : (
        showChecks && (
          <Fold title="Evidence" summary="All evidence linked on each check">
            <div className="py-1 text-body text-fg-2">All evidence linked on each check</div>
          </Fold>
        )
      )}

      <Card title="Coverage and documents" summary={coverageSummary(panel)}>
        {panel.coverage.map((row) => (
          <CheckLine key={row.id} row={row} onOpen={onOpen} valueDanger={row.found.includes("pipeline error")} />
        ))}
        {panel.documentNotes.map((row) => (
          <CheckLine key={row.id} row={row} onOpen={onOpen} locked={lockedDoc(row.docId)} />
        ))}
        {panel.documents.map((doc) => (
          <DocumentLine key={doc.id} doc={doc} onOpen={onOpen} />
        ))}
      </Card>

      <Fold title="Activity" summary={String(panel.activity.length)}>
        {panel.activity.map((entry) => (
          <div key={`${entry.at}-${entry.to}`} className="flex min-h-8 flex-wrap items-baseline gap-x-2 py-1 text-body">
            <span className="tabular shrink-0 text-caption text-fg-2">{fmtTableDate(new Date(entry.at))}</span>
            <span className="text-fg">{entry.actor}</span>
            <span className="text-fg-2">
              {entry.from} → {entry.to}
            </span>
            <span className="text-fg-2">{entry.reason}</span>
          </div>
        ))}
      </Fold>
    </div>
  );
}

function statusTone(panel: ReviewModel): string {
  if (panel.status === "CANCELLED") return "cancelled";
  if (panel.status === "CLOSED_DENIED" || panel.status === "DENIED") return "denied";
  if (panel.status === "APPROVED" || panel.status === "NOT_REQUIRED") return "approved";
  if (panel.status === "CLINICAL_REVIEW" || panel.status === "RULE_GAP" || panel.status === "APPEAL") return "nurse";
  if (panel.status === "UNREADABLE" || panel.status === "UNMATCHED" || panel.status === "AWAITING_DOCUMENTS" || panel.status === "NEEDS_CORRECTION" || panel.status === "MORE_INFO_REQUESTED") {
    return "coordinator";
  }
  if (panel.status === "READY_TO_SUBMIT" && panel.orderChannel === "portal") return "coordinator";
  return "system";
}

function contextLine(panel: ReviewModel): string {
  const channel = !panel.channelKnown ? "" : panel.context.channel === "portal" ? "portal only" : "API";
  return [panel.context.policyId, channel, panel.context.constraint].filter(Boolean).join(" · ");
}

function criteriaTitle(panel: ReviewModel): string {
  const { policyId, rev, assumption } = panel.checks.criteria;
  const base = `Insurer criteria · ${policyId} rev ${rev}`;
  return assumption ? `${base}, checked for ${assumption}` : base;
}

function coverageSummary(panel: ReviewModel): string {
  const failed = panel.coverage.filter((row) => row.result === "NOT_MET").length;
  if (failed > 0) return `${failed} failed`;
  const count = panel.documents.length;
  return `${count} ${count === 1 ? "document" : "documents"}`;
}

function Card({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  return (
    <section data-review={title} className="rounded-lg border border-line bg-panel">
      <header className="flex h-8 items-center gap-2 px-4">
        <h2 className="text-body font-medium text-fg">{title}</h2>
        {summary && <span className="ml-auto text-caption text-fg-2">{summary}</span>}
      </header>
      <div className="px-4 pb-2">{children}</div>
    </section>
  );
}

function Fold({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-lg border border-line bg-panel" data-review={title}>
      <Collapsible.Trigger className="flex h-8 w-full items-center gap-1 px-4 text-left">
        <ChevronRight size={14} className={cn("text-fg-3 transition-transform", open && "rotate-90")} />
        <span className="text-body font-medium text-fg">{title}</span>
        {summary && <span className="ml-auto text-caption text-fg-2">{summary}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="animate-collapsible px-4 pb-2">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function Group({ title, rows, onOpen }: { title: string; rows: CheckRow[]; onOpen: (cite: OpenPage) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-caption text-fg-2">{title}</div>
      {rows.map((row) => (
        <CheckLine key={row.id} row={row} onOpen={onOpen} />
      ))}
    </div>
  );
}

function CheckLine({
  row,
  onOpen,
  valueDanger,
  locked,
}: {
  row: CheckRow;
  onOpen: (cite: OpenPage) => void;
  valueDanger?: boolean;
  locked?: boolean;
}) {
  return (
    <ReviewRow
      lead={<ResultPill result={row.result} />}
      label={row.label}
      value={row.found}
      valueDanger={valueDanger}
      page={row.page}
      quote={row.quote}
      docId={row.docId}
      onOpen={onOpen}
      locked={locked}
    />
  );
}

function ReviewRow({
  lead,
  label,
  value,
  labelDanger,
  valueDanger,
  page,
  quote,
  docId,
  onOpen,
  locked,
}: {
  lead: ReactNode;
  label: string;
  value: string;
  labelDanger?: boolean;
  valueDanger?: boolean;
  page?: number;
  quote?: string;
  docId?: string;
  onOpen: (cite: OpenPage) => void;
  locked?: boolean;
}) {
  return (
    <div data-row className="grid min-h-8 grid-cols-review items-center gap-2 border-b border-line py-1">
      <span className="min-w-0">{lead}</span>
      <span className={cn("min-w-0 text-body", labelDanger ? "text-bad" : "text-fg")}>{label}</span>
      <span className={cn("min-w-0 text-body", valueDanger ? "text-bad" : "text-fg-2")}>{value}</span>
      <span>
        {page && docId && !locked ? (
          <CitationChip page={page} excerpt={quote} onOpen={() => onOpen({ docId, page, quote })} />
        ) : null}
      </span>
    </div>
  );
}

function DocumentLine({
  doc,
  onOpen,
}: {
  doc: ReviewModel["documents"][number];
  onOpen: (cite: OpenPage) => void;
}) {
  const quarantined = doc.status === "QUARANTINED";
  const label = doc.status === "ATTACHED" ? "Attached" : doc.status === "UNREADABLE" ? "Unreadable" : doc.status === "QUARANTINED" ? "Quarantined" : doc.status === "SUPERSEDED" ? "Superseded" : "Received";
  return (
    <ReviewRow
      lead={<span className="text-caption text-fg-2">{label}</span>}
      label={doc.type}
      value={quarantined ? "Removed from packet" : `${doc.pages} ${doc.pages === 1 ? "page" : "pages"}`}
      page={quarantined ? undefined : 1}
      docId={quarantined ? undefined : doc.id}
      onOpen={onOpen}
      locked={quarantined}
    />
  );
}

function ResolveList({
  panel,
  order,
  role,
  actorId,
  onApplied,
}: {
  panel: ReviewModel;
  order: Order;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedReview) => void;
}) {
  const [note, setNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [portalReference, setPortalReference] = useState("");
  const defined = actionsFor(snapshotOf(order), role);
  const rendered = renderActions(snapshotOf(order), role, { note, cancelReason, portalReference });
  let primaryUsed = false;

  return (
    <div>
      {panel.toResolve.map((item) => {
        const match = defined.find((action) => action.label === item.action?.label);
        const view = rendered.find((action) => action.label === item.action?.label);
        const primary = !!item.action && !item.readOnly && !primaryUsed;
        if (primary) primaryUsed = true;
        return (
          <div key={`${item.text}-${item.action?.label ?? "read"}`} className="flex items-center gap-2 border-b border-line py-2">
            <div className="min-w-0 flex-1">
              <div className="text-body text-fg">{item.text}</div>
              <div className="text-caption text-fg-2">
                {item.owner}
                {item.contact ? ` · ${item.contact}` : ""}
              </div>
            </div>
            {item.due && <span className="tabular text-caption text-fg-2">{item.due}</span>}
            {item.readOnly && <span className="text-caption text-fg-2">Owned by {item.owner}</span>}
            {item.action && !item.readOnly && (
              <ActionControl
                action={item.action}
                requires={match?.requires ?? []}
                disabled={view?.disabled ?? false}
                primary={primary}
                note={note}
                cancelReason={cancelReason}
                portalReference={portalReference}
                onNote={setNote}
                onCancel={setCancelReason}
                onPortal={setPortalReference}
                onRun={() => {
                  if (view?.disabled) return;
                  onApplied(
                    runReviewAction(order, { id: actorId, role }, item.action!, {
                      note,
                      cancelReason,
                      portalReference,
                    }),
                  );
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionControl({
  action,
  requires,
  disabled,
  primary,
  note,
  cancelReason,
  portalReference,
  onNote,
  onCancel,
  onPortal,
  onRun,
}: {
  action: NonNullable<ReviewModel["toResolve"][number]["action"]>;
  requires: StatusAction["requires"];
  disabled: boolean;
  primary: boolean;
  note: string;
  cancelReason: string;
  portalReference: string;
  onNote: (value: string) => void;
  onCancel: (value: string) => void;
  onPortal: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <span className="flex items-center gap-2">
      {requires.includes("note") && (
        <input
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Review note"
          aria-label="Review note"
          className="h-7 w-36 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {requires.includes("cancelReason") && (
        <input
          value={cancelReason}
          onChange={(e) => onCancel(e.target.value)}
          placeholder="Cancel reason"
          aria-label="Cancel reason"
          className="h-7 w-36 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {requires.includes("portalReference") && (
        <input
          value={portalReference}
          onChange={(e) => onPortal(e.target.value)}
          placeholder="Portal reference"
          aria-label="Portal reference"
          className="h-7 w-36 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      <Button variant={primary ? "default" : "secondary"} disabled={disabled} onClick={onRun}>
        {action.label}
      </Button>
    </span>
  );
}

function snapshotOf(order: Order) {
  return {
    id: order.id,
    status: toOrderStatus(order.status),
    statusVersion: 1,
    channel: order.channel,
    blockingChecks: order.blockingChecks ?? [],
    fixableGaps: false,
    awaitingDocumentsEntries: 0,
    confirmOnly: order.confirmOnly === true,
    linkedApproval: order.linkedApproval === true,
    approval: null,
    createdAt: order.statusSince,
  };
}

function runReviewAction(
  order: Order,
  actor: { id: string; role: UserRole },
  action: NonNullable<ReviewModel["toResolve"][number]["action"]>,
  input: { note: string; cancelReason: string; portalReference: string },
): AppliedReview {
  if (!action.transition) {
    const state = new AuthState();
    recordSideEffect(state, sideEffect(action.sideEffect, order.id));
    return { label: action.label };
  }
  const state = new AuthState();
  const created = createOrder(state, {
    status: toOrderStatus(order.status),
    channel: order.channel,
    blockingChecks: order.blockingChecks ?? [],
    fixableGaps: action.transition === "AWAITING_DOCUMENTS",
    confirmOnly: order.confirmOnly === true,
    linkedApproval: order.linkedApproval === true,
  });
  const role = actor.role === "rules_admin" ? "nurse" : actor.role;
  const next = transitionOrder(state, created.id, action.transition, {
    actor: { kind: "user", id: actor.id, role, permissions: ["cancel"] },
    expectedVersion: created.statusVersion,
    reason: input.cancelReason.trim() || input.note.trim() || action.label,
    note: input.note.trim(),
    portalReference: input.portalReference.trim(),
    checkIds: order.blockingChecks,
  });
  const reason = readAudits(state, { orderId: created.id }).at(-1)?.reason ?? action.label;
  return {
    label: action.label,
    status: toStatusId(next.status),
    reason,
    confirmOnly: next.confirmOnly,
    linkedApproval: next.linkedApproval,
  };
}

function sideEffect(id: string | undefined, orderId: string): Effect {
  if (id === "notify_ordering_doctor") return { type: "notify_ordering_doctor", orderId };
  if (id === "message_ordering_doctor") return { type: "message_ordering_doctor", orderId };
  if (id === "open_packet") return { type: "open_packet", orderId };
  return { type: "resend_request", orderId };
}

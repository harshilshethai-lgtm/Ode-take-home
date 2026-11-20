import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { Button } from "@/components/ui/button";
import { CheckedAgainst } from "@/components/evaluation/CheckedAgainst";
import { RulesChangedBanner } from "@/components/evaluation/RulesChangedBanner";
import { CitationChip } from "@/components/ui/citation-chip";
import { RESULT_PRESENTATION } from "@/components/ui/result-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { actionsFor, type StatusAction } from "@/domain/priorAuth/actions";
import { REASON_ACTIONS } from "@/domain/priorAuth/reasons";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { renderActions } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { Effect, UserRole } from "@/domain/priorAuth/types";
import { checksCardVisible, checksSummary } from "@/domain/review/panel";
import { InsurerBlock } from "@/components/case/InsurerBlock";
import type { InsurerPanelModel } from "@/domain/insurer/view";
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
  processing: "border-status-system",
  admin: "border-status-coordinator",
  clinical: "border-status-nurse",
  submitted: "border-line",
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
  demotePrimary,
  chrome = true,
  insurer,
  onCheckNow,
}: {
  panel: ReviewModel;
  order: Order;
  role: UserRole;
  actorId: string;
  onOpen: (cite: OpenPage) => void;
  onApplied: (result: AppliedReview) => void;
  /** Another control on the case is the primary action. */
  demotePrimary?: boolean;
  /** The case page draws the header and the action banner itself. */
  chrome?: boolean;
  insurer?: InsurerPanelModel | null;
  onCheckNow?: () => void;
}) {
  const tone = statusTone(panel);
  const context = contextLine(panel);
  const showChecks = checksCardVisible(panel);
  const check = useOrderCheck(order.orderNumber);
  const lockedDoc = (docId?: string) => panel.documents.some((doc) => doc.id === docId && doc.status === "QUARANTINED");
  return (
    <div>
      {chrome && <section data-review="banner" className={cn("rounded-lg border bg-panel p-4", BORDER[tone] ?? "border-line")}>
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
      </section>}

      {chrome && panel.toResolve.length > 0 && (
        <SheetSection title="To resolve" summary={String(panel.toResolve.length)} defaultOpen review="To resolve">
          <ResolveList panel={panel} order={order} role={role} actorId={actorId} onApplied={onApplied} demotePrimary={demotePrimary} />
        </SheetSection>
      )}

      {showChecks && check.staleness && (
        <RulesChangedBanner staleness={check.staleness} onRerun={() => check.recheck(PEOPLE_BY_ID[actorId]?.name ?? "System")} />
      )}

      {(showChecks || panel.coverage.length > 0 || panel.documentNotes.length > 0) && (
        <SheetSection title="Checklist" summary={showChecks ? checksSummary(panel.checks.summary) : undefined} defaultOpen review="Checklist">
          <CheckTimeline title="Consistency" rows={panel.checks.consistency} onOpen={onOpen} lockedDoc={lockedDoc} />
          <CheckTimeline title={criteriaTitle(panel)} rows={panel.checks.criteria.rows} onOpen={onOpen} lockedDoc={lockedDoc} />
          <CheckTimeline title="Coverage" rows={panel.coverage} onOpen={onOpen} lockedDoc={lockedDoc} />
          <CheckTimeline title="Packet" rows={panel.documentNotes} onOpen={onOpen} lockedDoc={lockedDoc} />
          {showChecks && panel.checks.evaluatedAt && (
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
        </SheetSection>
      )}

      {insurer && <InsurerBlock panel={insurer} onCheckNow={onCheckNow} />}

      {failedEvidence(panel).length > 0 && (
        <SheetSection title="Evidence" summary={String(failedEvidence(panel).length)} defaultOpen review="Evidence">
          {failedEvidence(panel).map((block) => (
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
        </SheetSection>
      )}

      <SheetSection title="Documents" summary={coverageSummary(panel)} defaultOpen>
        {panel.documents.map((doc) => (
          <DocumentLine key={doc.id} doc={doc} onOpen={onOpen} />
        ))}
      </SheetSection>

      <SheetSection title="Activity" summary={String(panel.activity.length)}>
        {panel.activity.map((entry) => (
          <div key={`${entry.at}-${entry.to}`} className="flex min-h-8 flex-wrap items-baseline gap-x-2 py-1 text-body">
            <span className="tabular shrink-0 text-caption text-fg-2">{fmtTableDate(new Date(entry.at))}</span>
            <span className="text-fg">{entry.actor}</span>
            <span className="text-fg-2">{entry.from && entry.from !== entry.to ? `${entry.from} → ${entry.to}` : entry.to || entry.reason}</span>
            {entry.from && entry.reason ? <span className="text-fg-2">{entry.reason}</span> : null}
          </div>
        ))}
      </SheetSection>
    </div>
  );
}

function failedEvidence(panel: ReviewModel): ReviewModel["evidence"] {
  const open = new Set(
    [...panel.checks.consistency, ...panel.checks.criteria.rows, ...panel.coverage, ...panel.documentNotes]
      .filter((row) => row.result === "NOT_MET" || row.result === "UNCLEAR")
      .map((row) => row.id),
  );
  if (open.size === 0) return [];
  return panel.evidence.filter((block) => open.has(block.forCheckId));
}

function statusTone(panel: ReviewModel): string {
  if (panel.status === "CANCELLED") return "cancelled";
  if (panel.status === "DENIED") return "denied";
  if (panel.status === "APPROVED" || panel.status === "NOT_REQUIRED") return "approved";
  if (panel.status === "NEEDS_CLINICAL_REVIEW") return "clinical";
  if (panel.status === "NEEDS_ADMIN_REVIEW") return "admin";
  if (panel.status === "SUBMITTED") return "submitted";
  return "processing";
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

const MARK = {
  success: "bg-result-success-bg text-result-success",
  danger: "bg-result-danger-bg text-result-danger",
  warning: "bg-result-warning-bg text-result-warning",
  neutral: "bg-chip text-fg-2",
} as const;

function SheetSection({
  title,
  summary,
  defaultOpen = false,
  review,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  review?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-line" data-review={review ?? title}>
      <Collapsible.Trigger className="flex h-8 w-full items-center gap-1 text-left">
        <ChevronRight size={14} className={cn("text-fg-3 transition-transform", open && "rotate-90")} />
        <span className="text-body font-medium text-fg">{title}</span>
        {summary && <span className="ml-auto text-caption text-fg-2">{summary}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="animate-collapsible pb-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function CheckTimeline({
  title,
  rows,
  onOpen,
  lockedDoc,
}: {
  title: string;
  rows: CheckRow[];
  onOpen: (cite: OpenPage) => void;
  lockedDoc: (docId?: string) => boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-2 text-caption text-fg-2">{title}</div>
      <ol>
        {rows.map((row, index) => {
          const presentation = RESULT_PRESENTATION[row.result];
          const Icon = presentation.icon;
          const last = index === rows.length - 1;
          const locked = lockedDoc(row.docId);
          return (
            <li key={row.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn("flex size-4 items-center justify-center rounded-md", MARK[presentation.tone])}>
                  <Icon size={14} aria-hidden />
                </span>
                {!last && <span className="w-px flex-1 bg-line" />}
              </div>
              <div className={cn("flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2", !last && "pb-3")}>
                <span className="text-body text-fg">{row.label}</span>
                <span className={cn("min-w-0 text-body", row.found.includes("pipeline error") ? "text-bad" : "text-fg-2")}>{row.found}</span>
                {row.page && row.docId && !locked ? (
                  <CitationChip docId={row.docId} page={row.page} excerpt={row.quote} onOpen={() => onOpen({ docId: row.docId!, page: row.page!, quote: row.quote })} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
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
          <CitationChip docId={docId} page={page} excerpt={quote} onOpen={() => onOpen({ docId, page, quote })} />
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
  demotePrimary,
}: {
  panel: ReviewModel;
  order: Order;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedReview) => void;
  demotePrimary?: boolean;
}) {
  const [note, setNote] = useState("");
  const [portalReference, setPortalReference] = useState("");
  const defined = actionsFor({ reason: order.reasonCode }, role);
  const rendered = renderActions({ reason: order.reasonCode }, role, { note, portalReference });
  let primaryUsed = false;

  return (
    <div>
      {panel.toResolve.map((item) => {
        const match = defined.find((action) => action.label === item.action?.label);
        const view = rendered.find((action) => action.label === item.action?.label);
        const primary = !!item.action && !item.readOnly && !primaryUsed && !demotePrimary;
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
                portalReference={portalReference}
                onNote={setNote}
                onPortal={setPortalReference}
                onRun={() => {
                  if (view?.disabled) return;
                  onApplied(
                    runReviewAction(order, { id: actorId, role }, item.action!, {
                      note,
                      cancelReason: "",
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
  portalReference,
  onNote,
  onPortal,
  onRun,
}: {
  action: NonNullable<ReviewModel["toResolve"][number]["action"]>;
  requires: StatusAction["requires"];
  disabled: boolean;
  primary: boolean;
  note: string;
  portalReference: string;
  onNote: (value: string) => void;
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
  const defined = order.reasonCode ? REASON_ACTIONS[order.reasonCode].find((item) => item.label === action.label) : undefined;
  const state = new AuthState();
  const created = createOrder(state, {
    status: toOrderStatus(order.status),
    channel: order.channel,
    reason: order.reasonCode,
    step: order.step,
    detail: order.detail,
    blockingChecks: order.blockingChecks ?? [],
    confirmOnly: order.reasonCode === "CONFIRM_AFTER_FIX",
    linkedApproval: order.linkedApproval === true,
  });
  const role = actor.role === "rules_admin" ? "nurse" : actor.role;
  const next = transitionOrder(state, created.id, action.transition, {
    actor: { kind: "user", id: actor.id, role, permissions: ["cancel"] },
    expectedVersion: created.statusVersion,
    reason: defined?.reason ?? null,
    step: defined?.step ?? null,
    detail: order.detail,
    note: input.note.trim(),
    portalReference: input.portalReference.trim(),
    trigger: defined?.trigger,
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
  if (id === "request_clean_copy" || id === "request_patient_record" || id === "resend_request") return { type: "resend_request", orderId };
  return { type: "resend_request", orderId };
}

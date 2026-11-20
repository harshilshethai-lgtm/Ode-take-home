import { useState, type ReactNode } from "react";
import { Check, ChevronRight, CircleHelp, Clock, FileText, Image, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CitationChip } from "@/components/ui/citation-chip";
import { CheckedAgainst } from "@/components/evaluation/CheckedAgainst";
import { RulesChangedBanner } from "@/components/evaluation/RulesChangedBanner";
import {
  caseButtons,
  documentRows,
  documentSummary,
  orderFields,
  presentChecklist,
  type CaseButton,
  type ChecklistItem,
  type ChecklistView,
  type DocRow,
  type OrderField,
} from "@/domain/casePage";
import { actionsFor } from "@/domain/priorAuth/actions";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { explainReason, reasonChip, whatToDo } from "@/domain/priorAuth/reasons";
import { renderActions } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { Effect, OrderSnapshot, UserRole } from "@/domain/priorAuth/types";
import type { Evaluation } from "@/domain/rules/types";
import type { CaseRecord } from "@/domain/caseRecord";
import type { CheckResult, ReviewPanel } from "@/domain/review/types";
import type { Order } from "@/domain/types";
import { cn } from "@/lib/cn";
import { PEOPLE_BY_ID } from "@/data/people";
import { fmtTableDate } from "@/lib/format";
import { useOrderCheck } from "@/lib/useOrderCheck";
import { InsurerBlock } from "@/components/case/InsurerBlock";
import type { InsurerPanelModel } from "@/domain/insurer/view";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

interface OpenPage {
  docId: string;
  page: number;
  quote?: string;
}

export interface AppliedCase {
  label: string;
  status?: Order["status"];
  reason?: string;
  confirmOnly?: boolean;
  linkedApproval?: boolean;
}

function headlineSentences(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim()).length;
}

function scanStamp(iso: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
  return `${WEEKDAY.format(at)} ${at.getMonth() + 1}/${at.getDate()}, ${time}`;
}

export function CaseLayout({
  order,
  record,
  panel,
  role,
  actorId,
  onOpen,
  onApplied,
  insurer,
  onCheckNow,
}: {
  order: Order;
  record: CaseRecord;
  panel: ReviewPanel;
  role: UserRole;
  actorId: string;
  onOpen: (cite: OpenPage) => void;
  onApplied: (result: AppliedCase) => void;
  insurer?: InsurerPanelModel | null;
  onCheckNow?: () => void;
}) {
  const check = useOrderCheck(order.orderNumber);
  const checklist = presentChecklist(order, panel);
  const docs = documentRows(record, panel);
  const fields = orderFields(order, record, panel);

  return (
    <div className="flex flex-col gap-6">
      <AiSummary order={order} panel={panel} role={role} actorId={actorId} onApplied={onApplied} onCheckNow={onCheckNow} />
      {check.staleness && (
        <RulesChangedBanner staleness={check.staleness} onRerun={() => check.recheck(PEOPLE_BY_ID[actorId]?.name ?? "System")} />
      )}
      <div className="grid grid-cols-1 gap-6 case:grid-cols-2">
        <OrderBlock fields={fields} onOpen={onOpen} />
        <DocumentsBlock rows={docs} onOpen={onOpen} />
      </div>
      {checklist.groups.length > 0 && <ChecklistBlock view={checklist} evaluation={check.evaluation} onOpen={onOpen} />}
      {insurer && <InsurerBlock panel={insurer} onCheckNow={onCheckNow} />}
      {failedEvidence(panel).length > 0 && (
        <Fold title="Evidence" summary={String(failedEvidence(panel).length)} defaultOpen review="Evidence">
          <EvidenceBody blocks={failedEvidence(panel)} onOpen={onOpen} />
        </Fold>
      )}
      <Fold
        title="Activity"
        summary={panel.activity[0] ? `${panel.activity[0].actor} · ${panel.activity[0].to}` : String(panel.activity.length)}
        defaultOpen={false}
        review="Activity"
      >
        {panel.activity.map((entry) => (
          <div
            key={`${entry.at}-${entry.to}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line py-4 text-value last:border-b-0 last:pb-0 first:pt-0"
          >
            <span className="text-caption text-fg-2">{fmtTableDate(new Date(entry.at))}</span>
            <span className="text-fg">{entry.actor}</span>
            <span className="text-fg-2">
              {entry.from} → {entry.to}
            </span>
          </div>
        ))}
      </Fold>
    </div>
  );
}

function Block({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-block text-fg">{title}</h2>
        {summary && <span className="text-body text-fg-2">{summary}</span>}
      </div>
      {children}
    </section>
  );
}

function Fold({
  title,
  summary,
  defaultOpen,
  review,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen: boolean;
  review: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-review={review} className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <button type="button" className="flex w-full items-baseline justify-between gap-4 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="text-block text-fg">{title}</span>
        <span className="text-body text-fg-2">{summary}</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}

function AiSummary({
  order,
  panel,
  role,
  actorId,
  onApplied,
  onCheckNow,
}: {
  order: Order;
  panel: ReviewPanel;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedCase) => void;
  onCheckNow?: () => void;
}) {
  const submitted = toOrderStatus(order.status) === "SUBMITTED";
  const buttons = submitted ? [] : caseButtons(order.reasonCode, role);
  const headline = order.reasonCode ? explainReason(order.reasonCode, order.detail) : order.reason;
  const next = order.reasonCode ? whatToDo(order.reasonCode, order.detail) : "No person needs to act. The pipeline is still working.";
  const chip = order.reasonCode ? reasonChip(order.reasonCode) : null;
  const fix = panel.scan.deadline?.replace(/^Fix by /i, "");
  const risk = panel.scan.risk === "at_risk" || panel.scan.risk === "slot_at_risk";

  return (
    <section className="rounded-block border border-accent-line bg-accent-bg px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={18} className="text-accent-fg" aria-hidden="true" />
        <span className="text-body font-medium text-accent-fg">AI summary</span>
        {chip && <span className="inline-flex h-5 items-center rounded-md border border-accent-line px-2 text-caption font-medium text-accent-fg">{chip}</span>}
      </div>
      <div {...(headlineSentences(headline) <= 2 ? { "data-ai-summary": true } : {})} className="mt-2 text-lead text-fg">
        {headline}
      </div>
      <div className="mt-2 text-value text-fg-2">{next}</div>
      {order.otherIssues.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {order.otherIssues.map((issue) => (
            <li key={`${issue.code}-${issue.detail.document ?? issue.detail.line ?? ""}`} data-row className="flex items-start gap-2">
              <Chip>{reasonChip(issue.code)}</Chip>
              <span className="text-body text-fg-2">{issue.detail.line ? String(issue.detail.line) : explainReason(issue.code, issue.detail)}</span>
            </li>
          ))}
        </ul>
      )}
      {(order.scheduledAt || buttons.length > 0 || (submitted && onCheckNow)) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-accent-line pt-4">
          {order.scheduledAt ? (
            <div className="text-caption text-fg-2">
              Scan {scanStamp(order.scheduledAt)}
              {fix && (
                <>
                  {" · fix by "}
                  <span className={risk ? "text-warning" : undefined}>{fix}</span>
                </>
              )}
            </div>
          ) : (
            <span />
          )}
          {submitted && onCheckNow && (
            <Button variant="secondary" onClick={onCheckNow}>
              Check now
            </Button>
          )}
          {buttons.length > 0 && <SummaryActions order={order} role={role} actorId={actorId} buttons={buttons} onApplied={onApplied} />}
        </div>
      )}
    </section>
  );
}

function snapshotOf(order: Order): OrderSnapshot {
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
    fixableGaps: order.otherIssues.some((issue) => issue.code === "MISSING_DOCUMENTS"),
    scanCompleted: false,
    createdAt: order.statusSince,
  };
}

function sideEffect(id: string, orderId: string): Effect {
  if (id === "notify_ordering_doctor") return { type: "notify_ordering_doctor", orderId };
  if (id === "message_ordering_doctor") return { type: "message_ordering_doctor", orderId };
  if (id === "open_packet") return { type: "open_packet", orderId };
  return { type: "resend_request", orderId };
}

function SummaryActions({
  order,
  role,
  actorId,
  buttons,
  onApplied,
}: {
  order: Order;
  role: UserRole;
  actorId: string;
  buttons: CaseButton[];
  onApplied: (result: AppliedCase) => void;
}) {
  const [note, setNote] = useState("");
  const [portalReference, setPortalReference] = useState("");
  const snapshot = snapshotOf(order);
  const defined = actionsFor(snapshot, role);
  const rendered = renderActions(snapshot, role, { note, portalReference });
  const needsNote = buttons.some((button) => button.action?.requires.includes("note"));
  const needsPortal = buttons.some((button) => button.action?.requires.includes("portalReference"));

  function run(button: CaseButton) {
    const view = rendered.find((item) => item.id === button.id);
    if (view?.disabled) return;
    const action = button.action ?? defined.find((item) => item.id === button.id);
    if (!action?.to) {
      if (action) {
        const state = new AuthState();
        recordSideEffect(state, sideEffect(action.id, order.id));
      }
      onApplied({ label: button.label });
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
    const next = transitionOrder(state, created.id, action.to, {
      actor: { kind: "user", id: actorId, role, permissions: ["cancel"] },
      expectedVersion: created.statusVersion,
      reason: action.reason,
      step: action.step ?? null,
      detail: snapshot.detail,
      note: note.trim(),
      portalReference: portalReference.trim(),
      trigger: action.trigger,
      checkIds: snapshot.blockingChecks,
    });
    const reason = readAudits(state, { orderId: created.id }).at(-1)?.reason ?? button.label;
    onApplied({
      label: button.label,
      status: toStatusId(next.status),
      reason,
      confirmOnly: next.confirmOnly,
      linkedApproval: next.linkedApproval,
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {needsNote && (
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note"
          aria-label="Review note"
          className="h-8 w-56 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {needsPortal && (
        <input
          value={portalReference}
          onChange={(event) => setPortalReference(event.target.value)}
          placeholder="Portal reference"
          aria-label="Portal reference"
          className="h-8 w-40 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {buttons.map((button, index) => {
        const view = rendered.find((item) => item.id === button.id);
        return (
          <Button key={button.id} variant={index === 0 ? "default" : "secondary"} disabled={view?.disabled ?? false} onClick={() => run(button)}>
            {button.label}
          </Button>
        );
      })}
    </div>
  );
}

function OrderBlock({ fields, onOpen }: { fields: OrderField[]; onOpen: (cite: OpenPage) => void }) {
  return (
    <Block title="Order">
      <div className="grid grid-cols-2 gap-x-6">
        {fields.map((field, index) => (
          <div key={field.label} className={cn("min-w-0 py-4", index >= 2 && "border-t border-line")}>
            <div className="text-caption text-fg-2">{field.label}</div>
            <FieldValue field={field} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </Block>
  );
}

function FieldValue({ field, onOpen }: { field: OrderField; onOpen: (cite: OpenPage) => void }) {
  const className = cn("text-value", field.muted ? "text-fg-2" : "text-fg", field.mono && "font-mono");
  const value = field.label === "Exam" ? <ExamValue value={field.value} /> : field.value;
  if (!field.cite) return <div className={className}>{value}</div>;
  return (
    <button type="button" className="flex items-center gap-2 text-left" onClick={() => onOpen({ docId: field.cite!.docId, page: field.cite!.page, quote: field.cite!.quote })}>
      <span className={className}>{value}</span>
      <ChevronRight size={16} className="text-fg-3" aria-hidden="true" />
    </button>
  );
}

function ExamValue({ value }: { value: string }) {
  const parts = value.split(" · ");
  if (parts.length !== 2) return <>{value}</>;
  return (
    <>
      {parts[0]} · <span className="font-mono">{parts[1]}</span>
    </>
  );
}

function DocumentsBlock({ rows, onOpen }: { rows: DocRow[]; onOpen: (cite: OpenPage) => void }) {
  return (
    <Block title="Documents" summary={documentSummary(rows)}>
      {rows.map((row, index) => (
        <div key={row.id} className={cn("flex items-start gap-2 py-4", index > 0 && "border-t border-line")}>
          {row.image ? <Image size={16} className="mt-1 text-fg-2" /> : <FileText size={16} className="mt-1 text-fg-2" />}
          <div className="min-w-0 flex-1">
            <div className="text-value text-fg">{row.name}</div>
            <div className="text-body text-fg-2">{row.description}</div>
          </div>
          <CitationChip page={row.page} excerpt={row.quote} onOpen={() => onOpen({ docId: row.docId, page: row.page, quote: row.quote })} />
        </div>
      ))}
    </Block>
  );
}

function ChecklistBlock({ view, evaluation, onOpen }: { view: ChecklistView; evaluation: Evaluation | null; onOpen: (cite: OpenPage) => void }) {
  return (
    <Block title="Checklist" summary={view.summary}>
      {view.groups.map((group) => (
        <div key={group.title} className="border-b border-line py-4 last:border-b-0 last:pb-0 first:pt-0">
          <div className="mb-2 text-caption text-fg-2">{group.title}</div>
          {group.items.map((item) => (
            <ChecklistRow key={item.kind === "check" ? item.row.id : item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      ))}
      {evaluation?.rulesSnapshot && (
        <div className="border-t border-line pt-4 text-caption text-fg-2">
          <CheckedAgainst evaluation={evaluation} />
        </div>
      )}
    </Block>
  );
}

function ChecklistRow({ item, onOpen }: { item: ChecklistItem; onOpen: (cite: OpenPage) => void }) {
  const [open, setOpen] = useState(false);
  if (item.kind === "waiting") {
    return (
      <div className="flex items-center gap-2 py-2">
        <Clock size={16} className="text-fg-2" aria-hidden="true" />
        <span className="text-value text-fg-2">{item.label}</span>
      </div>
    );
  }
  if (item.kind === "collapse") {
    return (
      <div>
        <button type="button" className="flex w-full items-center gap-2 py-2 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <Check size={16} className="text-good" aria-hidden="true" />
          <span className="text-value text-fg">{item.label}</span>
        </button>
        {open &&
          item.rows.map((row) => (
            <div key={row.id} className="flex items-start gap-2 py-2 pl-6">
              <ResultIcon result={row.result} />
              <div className="min-w-0 flex-1">
                <div className="text-value text-fg">{row.label}</div>
                {row.found && <div className="text-body text-fg-2">{row.found}</div>}
              </div>
            </div>
          ))}
      </div>
    );
  }
  const row = item.row;
  return (
    <div className="flex items-start gap-2 py-2">
      <ResultIcon result={row.result} />
      <div className="min-w-0 flex-1">
        <div className="text-value text-fg">{row.label}</div>
        {row.found && <div className="text-body text-fg-2">{row.found}</div>}
      </div>
      {row.page != null && row.docId && <CitationChip page={row.page} excerpt={row.quote} onOpen={() => onOpen({ docId: row.docId!, page: row.page!, quote: row.quote })} />}
    </div>
  );
}

function ResultIcon({ result }: { result: CheckResult }) {
  if (result === "NOT_MET") return <X size={16} className="mt-1 text-bad" aria-hidden="true" />;
  if (result === "UNCLEAR") return <CircleHelp size={16} className="mt-1 text-warning" aria-hidden="true" />;
  return <Check size={16} className="mt-1 text-good" aria-hidden="true" />;
}

function failedEvidence(panel: ReviewPanel): ReviewPanel["evidence"] {
  const open = new Set(
    [...panel.checks.consistency, ...panel.checks.criteria.rows, ...panel.coverage, ...panel.documentNotes]
      .filter((row) => row.result === "NOT_MET" || row.result === "UNCLEAR")
      .map((row) => row.id),
  );
  if (open.size === 0) return [];
  return panel.evidence.filter((block) => open.has(block.forCheckId));
}

function EvidenceBody({ blocks, onOpen }: { blocks: ReviewPanel["evidence"]; onOpen: (cite: OpenPage) => void }) {
  return (
    <>
      {blocks.map((block) => (
        <div key={block.forCheckId} className="border-b border-line py-4 last:border-b-0 last:pb-0 first:pt-0">
          <div className="text-caption text-fg-2">Evidence for {block.fact}</div>
          {block.rows.map((row) => (
            <div key={`${block.forCheckId}-${row.page}-${row.source}`} className="mt-2 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-value text-fg">{row.source}</div>
                <div className="text-body text-fg-2">{row.value}</div>
                <div className="text-body text-fg-2">“{row.quote}”</div>
              </div>
              <CitationChip page={row.page} excerpt={row.quote} onOpen={() => onOpen({ docId: row.docId, page: row.page, quote: row.quote })} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

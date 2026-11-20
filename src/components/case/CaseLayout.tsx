import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText, Image, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CitationChip } from "@/components/ui/citation-chip";
import { SourceTag } from "@/components/ui/source-tag";
import { Tip } from "@/components/ui/tooltip";
import { ChecklistCard, EvidenceCard, StatusMark } from "@/components/case/ChecklistCard";
import { RulesChangedBanner } from "@/components/evaluation/RulesChangedBanner";
import {
  caseButtons,
  documentRows,
  documentSummary,
  orderFields,
  type CaseButton,
  type DocRow,
  type OrderField,
} from "@/domain/casePage";
import { composeAiSummary, presentChecklist, presentEvidenceCard } from "@/domain/checklistView";
import { CRITERION_STATUS_LABEL, label, policyVersionLabel } from "@/lib/labels";
import { versionHref } from "@/lib/evalNotice";
import type { CriterionStatus } from "@/domain/rules/types";
import { actionsFor } from "@/domain/priorAuth/actions";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { explainReason, reasonChip, whatToDo } from "@/domain/priorAuth/reasons";
import { renderActions } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { Effect, OrderSnapshot, UserRole } from "@/domain/priorAuth/types";
import type { CaseRecord } from "@/domain/caseRecord";
import { portalPacketFor } from "@/domain/portalPacket";
import type { ReviewPanel } from "@/domain/review/types";
import type { Order } from "@/domain/types";
import { cn } from "@/lib/cn";
import { SUBMIT_BY_HINT, parseDemoInstant } from "@/lib/demoClock";
import { fmtScanNumeric, fmtTableDate } from "@/lib/format";
import { PEOPLE_BY_ID } from "@/data/people";
import { useOrderCheck } from "@/lib/useOrderCheck";
import { InsurerBlock } from "@/components/case/InsurerBlock";
import type { InsurerPanelModel } from "@/domain/insurer/view";

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

function scanStamp(iso: string): string {
  return fmtScanNumeric(parseDemoInstant(iso));
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
  const base = presentChecklist(order, panel, record);
  const snap = check.evaluation?.rulesSnapshot ?? null;
  const checklist = snap
    ? { ...base, policyLabel: policyVersionLabel(snap.externalPolicyId, snap.sourceRevisionLabel, snap.versionNumber), policyHref: versionHref(snap.policyId, snap.versionId) }
    : base;
  const evidence = presentEvidenceCard(order, panel);
  const docs = documentRows(record, panel);
  const fields = orderFields(order, record, panel);

  return (
    <div className="flex flex-col gap-6">
      <AiSummary order={order} panel={panel} checklist={checklist} role={role} actorId={actorId} onApplied={onApplied} onCheckNow={onCheckNow} />
      {check.staleness && (
        <RulesChangedBanner staleness={check.staleness} onRerun={() => check.recheck(PEOPLE_BY_ID[actorId]?.name ?? "System")} />
      )}
      {order.submissionBlocked && <p data-helper className="text-body text-fg-2">Submission blocked until records arrive.</p>}
      <PortalChecklist order={order} record={record} />
      <div className="grid grid-cols-1 gap-6 case:grid-cols-2">
        <OrderBlock fields={fields} policy={checklist.policyLabel && checklist.policyHref ? { label: checklist.policyLabel, href: checklist.policyHref } : null} onOpen={onOpen} />
        <DocumentsBlock rows={docs} onOpen={onOpen} />
      </div>
      <ChecklistCard model={checklist} onOpen={onOpen} />
      {insurer && <InsurerBlock panel={insurer} onCheckNow={onCheckNow} />}
      <EvidenceCard lines={evidence} onOpen={onOpen} />
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

function summaryStatus(checklist: ReturnType<typeof presentChecklist>): CriterionStatus | null {
  const rows = checklist.criteria?.rows ?? [];
  const open = rows.filter((row) => row.status !== "met" && row.status !== "waived");
  if (open.length === 0) return null;
  return open.slice().sort((a, b) => statusRank(a.status) - statusRank(b.status))[0]?.status ?? null;
}

function statusRank(status: CriterionStatus): number {
  if (status === "not_met") return 0;
  if (status === "unknown") return 1;
  if (status === "needs_review") return 2;
  return 3;
}

function issueChip(code: Order["otherIssues"][number]["code"]): string {
  if (code === "CRITERIA_NOT_MET") return label(CRITERION_STATUS_LABEL, "not_met");
  if (code === "MISSING_DOCUMENTS") return label(CRITERION_STATUS_LABEL, "unknown");
  return reasonChip(code);
}

function AiSummary({
  order,
  panel,
  checklist,
  role,
  actorId,
  onApplied,
  onCheckNow,
}: {
  order: Order;
  panel: ReviewPanel;
  checklist: ReturnType<typeof presentChecklist>;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedCase) => void;
  onCheckNow?: () => void;
}) {
  const submitted = toOrderStatus(order.status) === "SUBMITTED";
  const buttons = submitted ? [] : caseButtons(order.reasonCode, role);
  const headline = order.reasonCode ? explainReason(order.reasonCode, order.detail) : order.reason;
  const next = order.reasonCode ? whatToDo(order.reasonCode, order.detail) : "No person needs to act. The pipeline is still working.";
  const summary = composeAiSummary(headline, next);
  const criterionStatus = summaryStatus(checklist);
  const chip = criterionStatus ? null : order.reasonCode ? reasonChip(order.reasonCode) : null;
  const deadlineLabel = panel.scan.deadline ?? "";
  const pastDue = /^past due/i.test(deadlineLabel);
  const fix = deadlineLabel.replace(/^(Past due · |Submit by |Fix by )/i, "");
  const risk = panel.scan.risk === "at_risk" || panel.scan.risk === "slot_at_risk";

  return (
    <section className="rounded-block border border-accent-line bg-accent-bg px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={16} className="text-accent-fg" aria-hidden="true" />
        <span className="text-body font-medium text-accent-fg">AI summary</span>
        {criterionStatus && <StatusMark status={criterionStatus} />}
        {chip && <span className="inline-flex h-5 items-center rounded-md border border-accent-line px-2 text-caption font-medium text-accent-fg">{chip}</span>}
      </div>
      <div data-ai-summary className="mt-2 text-body text-fg">
        {summary}
      </div>
      {order.otherIssues.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {order.otherIssues.map((issue) => (
            <li key={`${issue.code}-${issue.detail.document ?? issue.detail.line ?? ""}`} data-row className="flex items-start gap-2">
              <Chip>{issueChip(issue.code)}</Chip>
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
                  {pastDue ? " · Past due · " : " · Submit by "}
                  <Tip content={SUBMIT_BY_HINT}>
                    <span className={risk ? "text-warning" : undefined}>{fix}</span>
                  </Tip>
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
  if (id === "message_ordering_doctor" || id === "send_draft") return { type: "message_ordering_doctor", orderId };
  if (id === "open_packet") return { type: "open_packet", orderId };
  return { type: "resend_request", orderId };
}

function submits(button: CaseButton): boolean {
  return button.action?.to === "SUBMITTED" || button.action?.step === "SUBMITTING";
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
          placeholder="Confirmation number"
          aria-label="Portal reference"
          className="h-8 w-40 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
        />
      )}
      {buttons.map((button, index) => {
        const view = rendered.find((item) => item.id === button.id);
        return (
          <Button key={button.id} data-case-action={button.id} variant={index === 0 ? "default" : "secondary"} disabled={(view?.disabled ?? false) || (order.submissionBlocked === true && submits(button))} onClick={() => run(button)}>
            {button.label}
          </Button>
        );
      })}
    </div>
  );
}

function OrderBlock({
  fields,
  policy,
  onOpen,
}: {
  fields: OrderField[];
  policy: { label: string; href: string } | null;
  onOpen: (cite: OpenPage) => void;
}) {
  return (
    <Block title="Order">
      <div className="grid grid-cols-1 gap-x-6 fields:grid-cols-2">
        {fields.map((field, index) => (
          <div key={field.label} className={cn("min-w-0 border-t border-line py-4", index === 0 && "border-t-0", index === 1 && "fields:border-t-0")}>
            <div className="text-caption text-fg-2">{field.label}</div>
            {field.label === "Policy" && policy && !field.muted ? (
              <Link to={policy.href} className="text-value text-accent-fg">
                {policy.label}
              </Link>
            ) : (
              <FieldValue field={field} onOpen={onOpen} />
            )}
          </div>
        ))}
      </div>
    </Block>
  );
}

function FieldValue({ field, onOpen }: { field: OrderField; onOpen: (cite: OpenPage) => void }) {
  const className = cn("text-value", field.muted ? "text-fg-2" : "text-fg", field.mono && "font-mono");
  const value = field.label === "Exam" ? <ExamValue value={field.value} /> : field.value;
  const tags = (
    <>
      {field.handwritten && <span className="text-caption text-fg-3">Handwritten</span>}
      {field.unparsed && <span className="text-caption text-fg-3">Unparsed</span>}
      {field.cite && <CitationChip page={field.cite.page} excerpt={field.cite.quote} onOpen={() => onOpen({ docId: field.cite!.docId, page: field.cite!.page, quote: field.cite!.quote })} />}
      {field.origin === "epic" && <SourceTag lastRun={field.lastRun} />}
    </>
  );
  if (!field.cite && field.origin !== "epic" && !field.handwritten && !field.unparsed) return <div className={className}>{value}</div>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={className}>{value}</span>
      {tags}
    </div>
  );
}

function PortalChecklist({ order, record }: { order: Order; record: CaseRecord }) {
  const packet = portalPacketFor(order, record);
  const [copied, setCopied] = useState<string | null>(null);
  if (!packet) return null;
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <h2 className="text-block text-fg">Portal packet</h2>
      <p data-helper className="mt-1 text-body text-fg-2">Paste these fields, then upload the packet in order.</p>
      <div className="mt-4 flex flex-col gap-2">
        {packet.fields.map((field) => (
          <div key={field.label} className="flex items-center justify-between gap-4">
            <span className="min-w-0 text-body text-fg">
              <span className="text-fg-2">{field.label}</span> {field.value}
            </span>
            <Button variant="ghost" onClick={() => void copy(field.label, field.value)}>
              {copied === field.label ? "Copied" : "Copy"}
            </Button>
          </div>
        ))}
        {packet.files.map((file) => (
          <div key={file.label} className="text-body text-fg">
            {file.label} · {file.detail}
          </div>
        ))}
      </div>
    </section>
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


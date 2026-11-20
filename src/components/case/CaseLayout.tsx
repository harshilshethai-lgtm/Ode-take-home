import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, FileText, Image, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CitationChip } from "@/components/ui/citation-chip";
import { SourceTag } from "@/components/ui/source-tag";
import { ClinicalFacts } from "@/components/case/ClinicalFacts";
import { ChecklistCard, EvidenceCard } from "@/components/case/ChecklistCard";
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
import { activityLine, blockersFor, clinicalFacts, packetModel, slotWarning, type BlockerItem, type PacketModel } from "@/domain/casePane";
import { presentChecklist, presentEvidenceCard } from "@/domain/checklistView";
import { caseSummaryText } from "@/domain/guidance";
import { policyVersionLabel } from "@/lib/labels";
import { versionHref } from "@/lib/evalNotice";
import { actionsFor } from "@/domain/priorAuth/actions";
import { toOrderStatus, toStatusId } from "@/domain/priorAuth/legacy";
import { renderActions } from "@/domain/priorAuth/render";
import { AuthState, createOrder, readAudits, recordSideEffect, transitionOrder } from "@/domain/priorAuth/store";
import type { Effect, OrderSnapshot, UserRole } from "@/domain/priorAuth/types";
import type { CaseRecord } from "@/domain/caseRecord";
import { portalPacketFor } from "@/domain/portalPacket";
import type { ReviewPanel } from "@/domain/review/types";
import type { Order } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtTableDate } from "@/lib/format";
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
  onInboundFax,
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
  onInboundFax?: () => void;
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
  const withInsurer = order.status === "submitted" || order.status === "approved";
  const criteria = checklist.criteria?.rows ?? [];
  const allMet = criteria.length > 0 && criteria.every((row) => row.status === "met" || row.status === "waived");
  const facts = clinicalFacts(order, allMet);
  const packet = packetModel(order, record);
  const activity = panel.activity.filter((entry) => !entry.from || entry.from !== entry.to || Boolean(entry.reason));
  const policy = checklist.policyLabel && checklist.policyHref ? { label: checklist.policyLabel, href: checklist.policyHref } : null;
  const packetCard = (
    <PacketCard
      order={order}
      record={record}
      model={packet}
      role={role}
      actorId={actorId}
      onApplied={onApplied}
      onInboundFax={onInboundFax}
      onOpen={onOpen}
      insurer={withInsurer ? insurer : null}
      onCheckNow={onCheckNow}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {check.staleness && <RulesChangedBanner staleness={check.staleness} onRerun={() => check.recheck(PEOPLE_BY_ID[actorId]?.name ?? "System")} />}
      {withInsurer && packetCard}
      <AiSummary order={order} panel={panel} record={record} role={role} actorId={actorId} onApplied={onApplied} onOpen={onOpen} onInboundFax={onInboundFax} />
      <ChecklistCard model={checklist} onOpen={onOpen} />
      <EvidenceCard lines={evidence} onOpen={onOpen} />
      <OrderBlock fields={fields} policy={policy} onOpen={onOpen} />
      {facts && <ClinicalFacts model={facts} onOpen={onOpen} />}
      {!withInsurer && packetCard}
      <DocumentsBlock rows={docs} onOpen={onOpen} />
      <Fold title="Activity" summary={activity[0]?.to || activity[0]?.reason || "None"} defaultOpen={Boolean(order.pipelineActivity?.length)} review="Activity">
        {activity.map((entry) => (
          <div key={`${entry.at}-${entry.reason}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line py-4 text-value last:border-b-0 last:pb-0 first:pt-0">
            <span className="text-caption text-fg-2">{fmtTableDate(new Date(entry.at))}</span>
            <span className="text-fg">{entry.actor}</span>
            <span className="text-fg-2">{activityLine(entry)}</span>
            {entry.reason && activityLine(entry) !== entry.reason && <span className="basis-full text-body text-fg-2">{entry.reason}</span>}
          </div>
        ))}
      </Fold>
      <Fold title="Notes" summary={panel.documentNotes.length ? String(panel.documentNotes.length) : "None"} defaultOpen={false} review="Notes">
        {panel.documentNotes.length === 0 ? (
          <div className="text-body text-fg-2">No notes on this packet.</div>
        ) : (
          panel.documentNotes.map((note) => (
            <div key={note.id} className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="text-body text-fg">{note.label}</div>
                <div className="text-caption text-fg-2">{note.found}</div>
              </div>
              {note.quote && note.page ? (
                <CitationChip page={note.page} excerpt={note.quote} onOpen={() => onOpen({ docId: note.docId ?? "packet", page: note.page ?? 1, quote: note.quote ?? "" })} />
              ) : null}
            </div>
          ))
        )}
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
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
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

function actionCopy(order: Order): string {
  return caseSummaryText(order);
}

function lead(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function AiSummary({
  order,
  panel,
  record,
  role,
  actorId,
  onApplied,
  onOpen,
  onInboundFax,
}: {
  order: Order;
  panel: ReviewPanel;
  record: CaseRecord;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedCase) => void;
  onOpen: (cite: OpenPage) => void;
  onInboundFax?: () => void;
}) {
  const [asked, setAsked] = useState<"scan" | "review" | null>(null);
  const submitted = toOrderStatus(order.status) === "SUBMITTED";
  const buttons = (submitted ? [] : caseButtons(order.reasonCode, role)).filter((button) => button.id !== "uploaded" && button.id !== "open_packet");
  const draft = order.reasonCode === "RETURN_TO_PROVIDER";
  const summary = actionCopy(order);
  const blockers = blockersFor(order, record);
  const warning = slotWarning(order, panel.checks.receivedAt);

  return (
    <section className="rounded-block border border-accent-line bg-accent-bg px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={16} className="text-accent-fg" aria-hidden="true" />
        <span className="text-body font-medium text-accent-fg">{draft ? "Draft" : "Summary"}</span>
      </div>
      <div data-ai-summary className="mt-2 text-body text-fg">
        {summary}
      </div>
      {order.submissionBlocked && <p data-helper className="mt-3 text-body text-fg-2">Submission blocked until records arrive.</p>}
      {blockers.length > 0 && (
        <div className="mt-4">
          <div className="text-caption text-fg-2">{draft ? "Send to" : "Blockers"}</div>
          {blockers.map((item) => (
            <BlockerRow key={item.id} item={item} draft={draft} onOpen={onOpen} />
          ))}
        </div>
      )}
      {warning && (
        <div className="mt-4 border-t border-accent-line pt-4">
          <div className="text-body text-warning">{warning}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={asked !== null} onClick={() => setAsked("scan")}>
              {asked === "scan" ? "Reschedule requested" : "Reschedule scan"}
            </Button>
            <Button variant="secondary" disabled={asked !== null} onClick={() => setAsked("review")}>
              {asked === "review" ? "Expedited review requested" : "Request expedited review"}
            </Button>
          </div>
        </div>
      )}
      {buttons.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-4 border-t border-accent-line pt-4">
          <SummaryActions order={order} role={role} actorId={actorId} buttons={buttons} onApplied={onApplied} onInboundFax={onInboundFax} />
        </div>
      )}
    </section>
  );
}

function BlockerRow({ item, draft, onOpen }: { item: BlockerItem; draft: boolean; onOpen: (cite: OpenPage) => void }) {
  const who = draft ? [item.phone, item.fax ? `fax ${item.fax}` : null].filter(Boolean).join(" · ") : [item.who, item.phone, item.fax ? `fax ${item.fax}` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-4 border-b border-accent-line py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-body text-fg">{lead(draft ? item.who : item.item)}</div>
        {who && <div className="text-caption text-fg-2">{who}</div>}
        {item.note && <div className="text-caption text-fg-2">{item.note}</div>}
      </div>
      {item.epic ? (
        <SourceTag lastRun="on file" />
      ) : item.cite ? (
        <CitationChip docId={item.cite.docId} page={item.cite.page} label={item.cite.label} excerpt={item.cite.quote} onOpen={() => onOpen({ docId: item.cite!.docId, page: item.cite!.page, quote: item.cite!.quote })} />
      ) : null}
    </div>
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
  onInboundFax,
}: {
  order: Order;
  role: UserRole;
  actorId: string;
  buttons: CaseButton[];
  onApplied: (result: AppliedCase) => void;
  onInboundFax?: () => void;
}) {
  const [note, setNote] = useState("");
  const [portalReference, setPortalReference] = useState("");
  const snapshot = snapshotOf(order);
  const defined = actionsFor(snapshot, role);
  const rendered = renderActions(snapshot, role, { note, portalReference });
  const needsNote = buttons.some((button) => button.action?.requires.includes("note"));
  const needsPortal = buttons.some((button) => button.action?.requires.includes("portalReference"));

  function run(button: CaseButton) {
    if ((button.id === "documents_received" || button.id === "copy_received") && onInboundFax) {
      onInboundFax();
      return;
    }
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
    <Block title="Request details">
      <div className="grid grid-cols-1 gap-x-6 fields:grid-cols-2">
        {fields.map((field, index) => (
          <div key={field.label} className={cn("min-w-0 border-t border-line py-4", index === 0 && "border-t-0", index === 1 && "fields:border-t-0")}>
            <div className="text-caption text-fg-2">{field.label}</div>
            {field.label === "Policy" && policy && !field.muted ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link to={policy.href} className="text-value text-accent-fg">
                  {policy.label}
                </Link>
                {field.cite && (
                  <CitationChip docId={field.cite.docId} page={field.cite.page} label={field.cite.label} excerpt={field.cite.quote} onOpen={() => onOpen({ docId: field.cite!.docId, page: field.cite!.page, quote: field.cite!.quote })} />
                )}
              </div>
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
      {field.cite && <CitationChip docId={field.cite.docId} page={field.cite.page} label={field.cite.label} excerpt={field.cite.quote} onOpen={() => onOpen({ docId: field.cite!.docId, page: field.cite!.page, quote: field.cite!.quote })} />}
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

function PortalChecklist({ order, record, nested = false }: { order: Order; record: CaseRecord; nested?: boolean }) {
  const packet = order.channel === "portal" || order.reasonCode === "PORTAL_UPLOAD" ? portalPacketFor({ ...order, reasonCode: "PORTAL_UPLOAD" }, record) : null;
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
  const body = (
    <>
      {nested ? null : <h2 className="text-block text-fg">Portal packet</h2>}
      <p data-helper className="mt-1 text-body text-fg-2">
        {order.reasonCode === "PORTAL_UPLOAD" && !order.submissionBlocked ? "Paste these fields, then upload the packet in order." : "Copy these fields for the portal."}
      </p>
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
    </>
  );
  if (nested) return <div className="mt-4">{body}</div>;
  return <section className="rounded-block border border-line-strong bg-panel px-6 py-5">{body}</section>;
}

function ExamValue({ value }: { value: string }) {
  const parts = value.split(" · ");
  const cpt = parts[parts.length - 1] ?? "";
  if (!/^\d{5}$/.test(cpt) || parts.length < 2) return <>{value}</>;
  return (
    <>
      {parts.slice(0, -1).join(" · ")} · <span className="font-mono">{cpt}</span>
    </>
  );
}

function PacketCard({
  order,
  record,
  model,
  role,
  actorId,
  onApplied,
  onInboundFax,
  onOpen,
  insurer,
  onCheckNow,
}: {
  order: Order;
  record: CaseRecord;
  model: PacketModel;
  role: UserRole;
  actorId: string;
  onApplied: (result: AppliedCase) => void;
  onInboundFax?: () => void;
  onOpen: (cite: OpenPage) => void;
  insurer?: InsurerPanelModel | null;
  onCheckNow?: () => void;
}) {
  const portalButtons = caseButtons(order.reasonCode, role).filter((button) => button.id === "uploaded" || button.id === "open_packet");
  return (
    <section className="rounded-block border border-line-strong bg-panel px-6 py-5">
      <h2 className="text-block text-fg">Packet & submission</h2>
      {model.attachments.length > 0 && (
        <div className="mt-4">
          {model.attachments.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
              <span className="text-body text-fg">{item.label}</span>
              <span className="flex items-center gap-2">
                {item.met ? <Check size={16} className="text-good" aria-label="Present" /> : <span className="text-body text-fg-2">Missing</span>}
                {item.cite && (
                  <CitationChip docId={item.cite.docId} page={item.cite.page} label={item.cite.label} excerpt={item.cite.quote} onOpen={() => onOpen({ docId: item.cite!.docId, page: item.cite!.page, quote: item.cite!.quote })} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 text-body text-fg">{model.pages}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-body text-fg">
        <span>{model.channel}</span>
        {model.channelCite && (
          <CitationChip
            docId={model.channelCite.docId}
            page={model.channelCite.page}
            label={model.channelCite.label}
            excerpt={model.channelCite.quote}
            onOpen={() => onOpen({ docId: model.channelCite!.docId, page: model.channelCite!.page, quote: model.channelCite!.quote })}
          />
        )}
      </div>
      <PortalChecklist order={order} record={record} nested />
      {portalButtons.length > 0 && (
        <div className="mt-4">
          <SummaryActions order={order} role={role} actorId={actorId} buttons={portalButtons} onApplied={onApplied} onInboundFax={onInboundFax} />
        </div>
      )}
      {insurer && <InsurerBlock panel={insurer} onCheckNow={onCheckNow} embedded />}
    </section>
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
          <CitationChip docId={row.docId} page={row.page} excerpt={row.quote} onOpen={() => onOpen({ docId: row.docId, page: row.page, quote: row.quote })} />
        </div>
      ))}
    </Block>
  );
}


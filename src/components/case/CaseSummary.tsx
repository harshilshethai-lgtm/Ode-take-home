import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { OrderActions } from "@/components/priorAuth/OrderActions";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CitationChip } from "@/components/ui/citation-chip";
import { DEMO_NOW } from "@/data/orders";
import { fixByAt } from "@/domain/timeRisk";
import { ORDER_STATUS_INFO } from "@/domain/priorAuth/catalog";
import { toOrderStatus } from "@/domain/priorAuth/legacy";
import { buildCaseSummary, compactTrail, deadlineLine } from "@/domain/priorAuth/summary";
import type { OrderStatus, ProcessingStep, ReasonCode, UserRole } from "@/domain/priorAuth/types";
import type { CaseRecord, ExtractRow } from "@/domain/caseRecord";
import type { ReviewPanel } from "@/domain/review/types";
import { ownerRoleFor } from "@/domain/statuses";
import type { Order } from "@/domain/types";
import { cn } from "@/lib/cn";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function scanLabel(iso: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
  return `${WEEKDAY.format(at)} ${at.getMonth() + 1}/${at.getDate()} ${time}`;
}

function fixLabel(at: Date): string {
  return `${WEEKDAY.format(at)} ${at.getMonth() + 1}/${at.getDate()}`;
}

const BANNER: Record<string, string> = {
  processing: "bg-status-system-bg",
  admin: "bg-status-coordinator-bg",
  clinical: "bg-status-nurse-bg",
  submitted: "bg-chip",
  approved: "bg-status-approved-bg",
  denied: "bg-status-denied-bg",
  cancelled: "bg-chip",
};

function bannerTone(status: OrderStatus): string {
  if (status === "CANCELLED") return "cancelled";
  if (status === "DENIED") return "denied";
  if (status === "APPROVED" || status === "NOT_REQUIRED") return "approved";
  if (status === "NEEDS_CLINICAL_REVIEW") return "clinical";
  if (status === "NEEDS_ADMIN_REVIEW") return "admin";
  if (status === "SUBMITTED") return "submitted";
  return "processing";
}

interface OpenPage {
  docId: string;
  page: number;
  quote?: string;
}

/** Banner, the facts on this order, and the notes pulled from its packet. */
export function CaseSummaryCard({
  order,
  record,
  panel,
  role,
  actorId,
  onOpen,
  onApplied,
  demotePrimary,
  onCheckNow,
}: {
  order: Order;
  record: CaseRecord;
  panel: ReviewPanel;
  role: UserRole;
  actorId: string;
  onOpen: (cite: OpenPage) => void;
  onApplied: (result: { status?: Order["status"]; reason?: string; confirmOnly?: boolean; linkedApproval?: boolean }) => void;
  demotePrimary?: boolean;
  onCheckNow?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = toOrderStatus(order.status);
  const closed = ORDER_STATUS_INFO[status].group === "closed";
  const scanAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const fixBy = scanAt && !closed ? fixByAt(scanAt, order.insurer) : null;
  const summary = buildCaseSummary({
    status,
    reason: order.reasonCode,
    step: order.step,
    detail: order.detail,
    otherIssues: order.otherIssues,
    role,
    actions: [],
    deadline: deadlineLine(scanAt ? scanLabel(order.scheduledAt!) : null, fixBy ? fixLabel(fixBy) : null),
    scanAtRisk: status === "SUBMITTED" && scanAt != null && (scanAt.getTime() - DEMO_NOW.getTime()) / 36e5 <= 24,
    trail: trailFor(order),
  });
  const owner = ownerRoleFor(order.status, order.channel);
  const viewerOwns = owner === role || (owner === "nurse" && role === "rules_admin");
  const groups = groupExtracted(record.extracted);
  const eligibility = panel.coverage.find((row) => row.label === "Eligibility");

  return (
    <div data-case-summary>
      <section className={cn("mt-4 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2", BANNER[bannerTone(status)])}>
        <div className="min-w-0 flex-1">
          {(summary.chip || summary.scanAtRisk) && (
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {summary.chip && !closed && <Chip>{summary.chip}</Chip>}
              {summary.chip && closed && <span className="text-caption text-fg-3">{summary.chip}</span>}
              {summary.scanAtRisk && <span className="text-caption text-bad">Scan at risk</span>}
            </div>
          )}
          <div className="text-body text-fg">{summary.explanation}</div>
          <div className="text-caption text-fg-2">{summary.whatToDo}</div>
          {summary.deadline && (
            <div className={cn("tabular text-caption", summary.scanAtRisk ? "text-bad" : "text-fg-2")}>{summary.deadline}</div>
          )}
          {!viewerOwns && owner !== "system" && <div className="text-caption text-fg-2">Owned by {owner}</div>}
        </div>
        {status === "SUBMITTED" && onCheckNow && (
          <Button variant="secondary" onClick={onCheckNow}>
            Check now
          </Button>
        )}
        {!closed && status !== "SUBMITTED" && order.reasonCode && (
          <OrderActions
            order={order}
            role={role}
            actorId={actorId}
            fixableGaps={order.otherIssues.some((issue) => issue.code === "MISSING_DOCUMENTS")}
            demotePrimary={demotePrimary}
            onApplied={onApplied}
          />
        )}
      </section>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 py-4">
        {record.elements.map((item) => (
          <Fact
            key={item.label}
            label={item.label}
            value={item.value}
            mono={item.mono}
            missing={item.value === "Not found"}
            risk={item.label === "Scan slot" ? panel.scan.risk : undefined}
            note={item.label === "Scan slot" ? panel.scan.deadline : undefined}
            onOpen={item.cite ? () => onOpen({ docId: item.cite!.docId, page: item.cite!.page, quote: item.cite!.quote }) : undefined}
          />
        ))}
        <Fact label="Urgency" value={order.priority} missing={false} danger={order.priority === "Urgent"} />
        {eligibility && (
          <Fact
            label="Eligibility"
            value={eligibility.found}
            missing={eligibility.result === "NOT_MET"}
            onOpen={
              eligibility.page && eligibility.docId
                ? () => onOpen({ docId: eligibility.docId!, page: eligibility.page!, quote: eligibility.quote })
                : undefined
            }
          />
        )}
      </div>

      {summary.otherIssues.length > 0 && (
        <ul className="mb-3 space-y-1">
          {summary.otherIssues.map((issue) => (
            <li key={`${issue.code}-${issue.explanation}`} className="flex items-start gap-2 text-caption text-fg-2">
              <Chip>{issue.chip}</Chip>
              <span>{issue.explanation}</span>
            </li>
          ))}
        </ul>
      )}

      {groups.map((group, index) => (
        <SheetSection key={group.section} title={group.section} count={group.rows.length} defaultOpen={index === 0}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {group.rows.map((row, rowIndex) => (
              <ExtractField key={`${row.label}-${rowIndex}`} row={row} onOpen={onOpen} />
            ))}
          </div>
        </SheetSection>
      ))}

      {summary.trail.length > 1 && (
        <div className="border-t border-line py-2">
          <div className="text-caption text-fg-2">{compactTrail(summary.trail, expanded)}</div>
          <button type="button" className="text-caption text-accent-fg" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Hide steps" : "Show steps"}
          </button>
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
  missing,
  danger,
  risk,
  note,
  onOpen,
}: {
  label: string;
  value: string;
  mono?: boolean;
  missing?: boolean;
  danger?: boolean;
  risk?: ReviewPanel["scan"]["risk"];
  note?: string;
  onOpen?: () => void;
}) {
  const valueClass = cn(
    "min-w-0 text-body",
    missing || danger ? "text-bad" : "text-fg",
    mono && "font-mono text-caption",
  );
  return (
    <div className="min-w-0">
      <div className="text-caption text-fg-2">{label}</div>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex max-w-full items-center gap-1 text-left hover:text-accent-fg">
          <span className={valueClass}>{value}</span>
          <ChevronRight size={14} className="shrink-0 text-fg-3" />
        </button>
      ) : (
        <div className={valueClass}>{value}</div>
      )}
      {note && (
        <div className={cn("text-caption", risk === "slot_at_risk" && "text-bad", risk === "at_risk" && "text-warning", risk === "on_track" && "text-fg-2")}>
          {note}
        </div>
      )}
    </div>
  );
}

function ExtractField({ row, onOpen }: { row: ExtractRow; onOpen: (cite: OpenPage) => void }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-caption text-fg-2">{row.label}</div>
      <div className="flex min-h-7 items-center gap-2 rounded-md border border-line px-2 py-1">
        <span className="min-w-0 flex-1 text-body text-fg">{row.excerpt}</span>
        <CitationChip page={row.cite.page} excerpt={row.cite.quote} onOpen={() => onOpen({ docId: row.cite.docId, page: row.cite.page, quote: row.cite.quote })} />
      </div>
    </div>
  );
}

function SheetSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-line">
      <Collapsible.Trigger className="flex h-8 w-full items-center gap-1 text-left">
        <ChevronRight size={14} className={cn("text-fg-3 transition-transform", open && "rotate-90")} />
        <span className="text-body font-medium text-fg">{title}</span>
        {count !== undefined && <span className="tabular text-caption text-fg-2">{count}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="animate-collapsible pb-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function groupExtracted(rows: ExtractRow[]): Array<{ section: string; rows: ExtractRow[] }> {
  const groups: Array<{ section: string; rows: ExtractRow[] }> = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.section === row.section) last.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  return groups;
}

function trailFor(order: Order): Array<{ status: OrderStatus; reason: ReasonCode | null; steps?: ProcessingStep[]; detail?: Order["detail"] }> {
  const status = toOrderStatus(order.status);
  if (status === "PROCESSING") {
    return [{ status: "PROCESSING", reason: null, steps: order.step ? [order.step] : [], detail: order.detail }];
  }
  return [
    { status: "PROCESSING", reason: null, steps: ["INTAKE", "EVALUATING"], detail: { insurer: order.insurer, n: "the" } },
    { status, reason: order.reasonCode, detail: order.detail },
  ];
}

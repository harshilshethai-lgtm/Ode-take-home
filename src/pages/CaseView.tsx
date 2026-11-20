import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PACKET_URLS } from "@/lib/packetUrls";
import { AssignMenu } from "@/components/AssignMenu";
import { DocumentPane, type OpenCite } from "@/components/case/DocumentPane";
import { CaseLayout, type AppliedCase } from "@/components/case/CaseLayout";
import { PageTitle } from "@/components/ui/page-title";
import { StatusPill } from "@/components/ui/status-pill";
import { Tip } from "@/components/ui/tooltip";
import { DEMO_NOW } from "@/data/orders";
import { ownerRoleFor, isClosed } from "@/domain/statuses";
import { buildCaseRecord, type CaseRecord } from "@/domain/caseRecord";
import { previewInsurerPanel, type InsurerPanelModel } from "@/domain/insurer/view";
import { getReviewPanel } from "@/domain/review/panel";
import { fmtDob } from "@/lib/format";
import { usePersona } from "@/lib/persona";
import { useOrders, type StatusPatch } from "@/lib/useWorklistState";
import type { UserRole } from "@/domain/priorAuth/types";
import type { Order } from "@/domain/types";

const URLS = PACKET_URLS;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export default function CaseView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { orders, assign, applyStatus } = useOrders();
  const { me } = usePersona();
  const order = orders.find((o) => o.id === id);
  const record = useMemo(() => (order ? buildCaseRecord(order) : null), [order]);
  const panel = useMemo(() => (order ? getReviewPanel(order.id, me.role, order) : null), [order, me.role]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.metaKey || isTyping(e.target)) return;
      if (document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]")) return;
      navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (!order || !record || !panel) {
    return (
      <div className="mx-auto max-w-page p-6">
        <PageTitle>Case not found</PageTitle>
        <Link to="/" className="mt-4 inline-flex h-7 items-center gap-1 text-body text-accent-fg">
          <ArrowLeft size={14} /> Worklist
        </Link>
      </div>
    );
  }

  return (
    <CaseBody
      record={record}
      panel={panel}
      order={order}
      me={me}
      assign={(pid) => assign([order.id], pid)}
      applyStatus={applyStatus}
    />
  );
}

function noteExtraChecks(panel: InsurerPanelModel | null, extra: number): InsurerPanelModel | null {
  if (!panel || extra === 0) return panel;
  return {
    ...panel,
    lastCheckedLabel: "Just now",
    timeline: [
      { id: `extra-${extra}`, kind: "status", time: "Just now", channel: panel.channelLabel, result: `${extra} ${extra === 1 ? "check" : "checks"}, no change, last just now` },
      ...panel.timeline,
    ],
  };
}

function caseTitle(order: Order): string {
  if (order.patient?.name) return order.patient.name;
  const words = order.study.trim().split(/\s+/);
  return words.length > 0 && words.length <= 3 ? order.study : "Unmatched";
}

function CaseBody({
  record,
  panel,
  order,
  me,
  assign,
  applyStatus,
}: {
  record: CaseRecord;
  panel: NonNullable<ReturnType<typeof getReviewPanel>>;
  order: Order;
  me: ReturnType<typeof usePersona>["me"];
  assign: (personId: string | null) => void;
  applyStatus: (id: string, patch: StatusPatch) => void;
}) {
  const [checks, setChecks] = useState(0);
  const insurer = useMemo(() => noteExtraChecks(previewInsurerPanel(order), checks), [order, checks]);
  const [target, setTarget] = useState<OpenCite | null>(
    record.documents[0] ? { docId: record.documents[0].id, page: record.documents[0].initialPage } : null,
  );
  const role = ownerRoleFor(order.status, order.channel);
  const openCite = (cite: OpenCite) => setTarget({ docId: cite.docId, page: cite.page, quote: cite.quote });
  const apply = (result: AppliedCase) => {
    if (!result.status) return;
    applyStatus(order.id, {
      status: result.status,
      reason: result.reason ?? order.reason,
      statusSince: DEMO_NOW.toISOString(),
      confirmOnly: result.confirmOnly,
      linkedApproval: result.linkedApproval,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col wide:flex-row">
      <div className="@container/case h-1/2 min-h-0 min-w-0 flex-1 overflow-auto bg-app wide:h-full">
        <div className="mx-auto w-full max-w-case px-4 py-4 wide:px-8 wide:py-8">
          <header className="mb-6 flex flex-wrap items-center gap-2">
            <Tip content="Worklist" shortcut="esc">
              <Link to="/" aria-label="Back to worklist" className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
                <ArrowLeft size={16} />
              </Link>
            </Tip>
            <h1 className="text-display text-fg">{caseTitle(order)}</h1>
            {order.patient && <span className="text-body text-fg-2">{fmtDob(order.patient.dob)}</span>}
            {order.orderNumber && <span className="font-mono text-caption text-fg-2">{order.orderNumber}</span>}
            <StatusPill status={order.status} channel={order.channel} reasonCode={order.reasonCode} />
            <span className="ml-auto">
              <AssignMenu role={role} assigneeId={order.assigneeId} me={me} closed={isClosed(order.status)} onAssign={assign} />
            </span>
          </header>
          <CaseLayout
            order={order}
            record={record}
            panel={panel}
            role={me.role as UserRole}
            actorId={me.id}
            onOpen={openCite}
            onApplied={apply}
            insurer={insurer}
            onCheckNow={insurer ? () => setChecks((count) => count + 1) : undefined}
          />
        </div>
      </div>
      <div className="h-1/2 min-h-0 min-w-0 wide:h-full wide:w-pane wide:shrink-0">
        <DocumentPane documents={record.documents} urls={URLS} target={target} onTarget={setTarget} />
      </div>
    </div>
  );
}

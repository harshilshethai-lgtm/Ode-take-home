import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PACKET_URLS } from "@/lib/packetUrls";
import { AssignMenu } from "@/components/AssignMenu";
import { DocumentPane, type OpenCite } from "@/components/case/DocumentPane";
import { ReviewPanelView } from "@/components/case/ReviewPanel";
import { PageTitle } from "@/components/ui/page-title";
import { Tip } from "@/components/ui/tooltip";
import { DEMO_NOW } from "@/data/orders";
import { ownerRoleFor, isClosed } from "@/domain/statuses";
import { buildCaseRecord } from "@/domain/caseRecord";
import { getReviewPanel } from "@/domain/review/panel";
import { usePersona } from "@/lib/persona";
import { useOrders, type StatusPatch } from "@/lib/useWorklistState";

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
      recordDocId={record.docId}
      documents={record.documents}
      panel={panel}
      order={order}
      me={me}
      assign={(pid) => assign([order.id], pid)}
      applyStatus={applyStatus}
    />
  );
}

function CaseBody({
  recordDocId,
  documents,
  panel,
  order,
  me,
  assign,
  applyStatus,
}: {
  recordDocId: string;
  documents: ReturnType<typeof buildCaseRecord>["documents"];
  panel: NonNullable<ReturnType<typeof getReviewPanel>>;
  order: NonNullable<ReturnType<typeof useOrders>["orders"][number]>;
  me: ReturnType<typeof usePersona>["me"];
  assign: (personId: string | null) => void;
  applyStatus: (id: string, patch: StatusPatch) => void;
}) {
  const [target, setTarget] = useState<OpenCite | null>(
    documents[0] ? { docId: documents[0].id, page: documents[0].initialPage } : null,
  );
  const role = ownerRoleFor(order.status, order.channel);

  return (
    <div className="flex h-full min-h-0">
      <div className="w-1/2 min-w-0 overflow-auto border-r border-line">
        <header className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-3">
          <div className="flex items-center gap-2">
            <Tip content="Worklist" shortcut="esc">
              <Link to="/" aria-label="Back to worklist" className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
                <ArrowLeft size={16} />
              </Link>
            </Tip>
            <PageTitle>{recordDocId}</PageTitle>
            <span className="ml-auto">
              <AssignMenu role={role} assigneeId={order.assigneeId} me={me} closed={isClosed(order.status)} onAssign={assign} />
            </span>
          </div>
        </header>

        <div className="p-4">
          <ReviewPanelView
            panel={panel}
            order={order}
            role={me.role}
            actorId={me.id}
            onOpen={(cite) => setTarget({ docId: cite.docId, page: cite.page, quote: cite.quote })}
            onApplied={(result) => {
              if (!result.status) return;
              applyStatus(order.id, {
                status: result.status,
                reason: result.reason ?? order.reason,
                statusSince: DEMO_NOW.toISOString(),
                confirmOnly: result.confirmOnly,
                linkedApproval: result.linkedApproval,
              });
            }}
          />
        </div>
      </div>

      <div className="w-1/2 min-w-0">
        <DocumentPane documents={documents} urls={URLS} target={target} onTarget={setTarget} />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { PACKET_URLS } from "@/lib/packetUrls";
import { AssignMenu } from "@/components/AssignMenu";
import { DocumentPane, type OpenCite } from "@/components/case/DocumentPane";
import { CaseLayout, type AppliedCase } from "@/components/case/CaseLayout";
import { policyAttachment } from "@/components/case/packetView";
import { PageTitle } from "@/components/ui/page-title";
import { StatusPill } from "@/components/ui/status-pill";
import { DocumentsProvider } from "@/components/ui/citation-chip";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { useOrderCheck } from "@/lib/useOrderCheck";
import { DEMO_NOW } from "@/data/orders";
import { ownerRoleFor, isClosed } from "@/domain/statuses";
import { buildCaseRecord, type CaseRecord } from "@/domain/caseRecord";
import { previewInsurerPanel } from "@/domain/insurer/view";
import { statusActivity } from "@/domain/caseStatus";
import { checkIsDue, runStatusCheck, settleDueCheck, type SettledCheck } from "@/domain/statusPoll";
import { getReviewPanel } from "@/domain/review/panel";
import { submitByAt } from "@/domain/timeRisk";
import { SUBMIT_BY_HINT, parseDemoInstant } from "@/lib/demoClock";
import { fmtCountdown, fmtDob } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePersona } from "@/lib/persona";
import { useOrders, type StatusPatch } from "@/lib/useWorklistState";
import type { UserRole } from "@/domain/priorAuth/types";
import type { Order } from "@/domain/types";

const URLS = PACKET_URLS;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export default function CaseView() {
  const { id } = useParams();
  const goBack = useWorklistBack();
  const { orders, assign, applyStatus, startInboundFax } = useOrders();
  const { me } = usePersona();
  const order = orders.find((o) => o.id === id);
  const record = useMemo(() => (order ? buildCaseRecord(order) : null), [order]);
  const panel = useMemo(() => (order ? getReviewPanel(order.id, me.role, order) : null), [order, me.role]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.metaKey || isTyping(e.target)) return;
      if (document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]")) return;
      goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

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
      onInboundFax={() => startInboundFax(order.id)}
      onBack={goBack}
    />
  );
}

function useWorklistBack() {
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/");
  }, [location.key, navigate]);
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
  onInboundFax,
  onBack,
}: {
  record: CaseRecord;
  panel: NonNullable<ReturnType<typeof getReviewPanel>>;
  order: Order;
  me: ReturnType<typeof usePersona>["me"];
  assign: (personId: string | null) => void;
  applyStatus: (id: string, patch: StatusPatch) => void;
  onInboundFax: () => void;
  onBack: () => void;
}) {
  const check = useOrderCheck(order.orderNumber);
  const policy = policyAttachment(order.policyRef, check.evaluation?.rulesSnapshot?.sourceDocument ?? null);
  const insurer = useMemo(() => previewInsurerPanel(order), [order]);
  const overdue = checkIsDue(order);
  const [pollState, setPollState] = useState<{ id: string; check: SettledCheck | null } | null>(null);
  const poll = pollState?.id === order.id ? pollState.check : null;
  useEffect(() => {
    setPollState({ id: order.id, check: overdue ? settleDueCheck(order) : null });
  }, [order, overdue]);
  const shownInsurer = useMemo(() => {
    if (!insurer) return null;
    if (overdue && !poll?.ran) return { ...insurer, nextCheckLabel: "Overdue" };
    if (!poll?.ran || !poll.timeline) return { ...insurer, nextCheckLabel: insurer.nextCheckLabel?.endsWith("ago") ? "Overdue" : insurer.nextCheckLabel };
    return {
      ...insurer,
      latestLabel: poll.latestLabel,
      latestRaw: null,
      lastCheckedLabel: poll.lastCheckedLabel,
      nextCheckLabel: poll.nextCheckLabel,
      nextCheckAt: poll.nextCheckAt,
      timeline: [poll.timeline, ...insurer.timeline],
    };
  }, [insurer, overdue, poll]);
  const shownPanel = useMemo(() => {
    if (!poll?.activity) return panel;
    return { ...panel, activity: [poll.activity, ...statusActivity(order)] };
  }, [panel, poll, order]);
  const submitBy = order.scheduledAt ? submitByAt(parseDemoInstant(order.scheduledAt), order.insurer) : null;
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
    <DocumentsProvider documents={record.documents}>
      <CaseSplit
        work={
          <div className="w-full p-6">
            <header className="mb-6 flex flex-wrap items-center gap-2">
              <Tip content="Worklist" shortcut="esc">
                <button type="button" aria-label="Back to worklist" onClick={onBack} className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
                  <ArrowLeft size={16} />
                </button>
              </Tip>
              <h1 className="text-display text-fg">{caseTitle(order)}</h1>
              {order.patient && <span className="text-body text-fg-2">{fmtDob(order.patient.dob)}</span>}
              {order.orderNumber && <span className="font-mono text-caption text-fg-2">{order.orderNumber}</span>}
              <StatusPill status={order.status} channel={order.channel} reasonCode={order.reasonCode} label={order.statusLabel} />
              <span className="text-body text-fg-2">{order.priority}</span>
              {submitBy && (
                <Tip content={SUBMIT_BY_HINT}>
                  <span className={cn("text-body tabular", submitBy.getTime() < DEMO_NOW.getTime() && "text-warning")}>
                    {submitBy.getTime() < DEMO_NOW.getTime() ? `Past due ${fmtCountdown(submitBy, DEMO_NOW).replace(/ ago$/, "")}` : `Submit by ${fmtCountdown(submitBy, DEMO_NOW).replace(/^in /, "")}`}
                  </span>
                </Tip>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="Case actions" className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
                    <MoreHorizontal size={16} />
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  <MenuItem onClick={onInboundFax}>Simulate inbound fax</MenuItem>
                </PopoverContent>
              </Popover>
              <span className="ml-auto">
                <AssignMenu role={role} assigneeId={order.assigneeId} me={me} closed={isClosed(order.status)} onAssign={assign} />
              </span>
            </header>
            <CaseLayout
              order={order}
              record={record}
              panel={shownPanel}
              role={me.role as UserRole}
              actorId={me.id}
              onOpen={openCite}
              onApplied={apply}
              onInboundFax={onInboundFax}
              insurer={shownInsurer}
              onCheckNow={shownInsurer ? () => setPollState({ id: order.id, check: runStatusCheck(order) }) : undefined}
            />
          </div>
        }
        viewer={
          <DocumentPane
            documents={record.documents}
            extracted={record.extracted}
            policy={policy}
            urls={URLS}
            target={target}
            onTarget={setTarget}
          />
        }
      />
    </DocumentsProvider>
  );
}

const SPLIT_KEY = "halcyon.case.split.v1";
const PANE_MIN = 360;

function readFraction(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    const value = raw == null ? Number.NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return 0.5;
    return value;
  } catch {
    return 0.5;
  }
}

function writeFraction(value: number) {
  try {
    localStorage.setItem(SPLIT_KEY, String(value));
  } catch {
    /* private mode */
  }
}

function useStacked() {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1099px)");
    const apply = () => setStacked(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return stacked;
}

function CaseSplit({ work, viewer }: { work: ReactNode; viewer: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const fractionRef = useRef(readFraction());
  const [fraction, setFraction] = useState(fractionRef.current);
  const [frameWidth, setFrameWidth] = useState(0);
  const [showDoc, setShowDoc] = useState(true);
  const stacked = useStacked();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [stacked]);

  const sized = !stacked && frameWidth >= PANE_MIN * 2;
  const viewerWidth = sized ? Math.min(Math.max(fraction * frameWidth, PANE_MIN), frameWidth - PANE_MIN) : undefined;
  const workWidth = sized && viewerWidth != null ? frameWidth - viewerWidth : undefined;

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame || stacked) return;
    event.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      const workPx = Math.min(Math.max(ev.clientX - rect.left, PANE_MIN), rect.width - PANE_MIN);
      const next = (rect.width - workPx) / rect.width;
      fractionRef.current = next;
      setFraction(next);
    };
    const up = () => {
      writeFraction(fractionRef.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => {
    fractionRef.current = 0.5;
    setFraction(0.5);
    writeFraction(0.5);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-auto">
      {stacked && (
        <div className="sticky top-0 z-20 flex h-8 shrink-0 items-center border-b border-line bg-panel px-6">
          <button
            type="button"
            className="text-body text-accent-fg"
            aria-pressed={showDoc}
            onClick={() => setShowDoc((value) => !value)}
          >
            {showDoc ? "Hide document" : "Show document"}
          </button>
        </div>
      )}
      <div ref={frameRef} className={stacked ? "flex min-h-0 min-w-0 flex-1 flex-col" : "relative flex min-h-0 min-w-0 flex-1"}>
        <div
          className="@container/case min-h-0 min-w-0 overflow-auto bg-app"
          style={workWidth != null ? { width: workWidth, flex: "none" } : { flex: "1 1 0" }}
        >
          {work}
        </div>
        {(!stacked || showDoc) && (
          <div
            className={stacked ? "min-h-0 min-w-0 border-t border-line bg-sidebar" : "min-h-0 min-w-0 border-l border-line bg-sidebar"}
            style={
              stacked
                ? { height: "50%", flex: "none", minWidth: PANE_MIN }
                : viewerWidth != null
                  ? { width: viewerWidth, flex: "none", minWidth: PANE_MIN }
                  : { flex: "1 1 0", minWidth: PANE_MIN }
            }
          >
            {viewer}
          </div>
        )}
        {!stacked && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize document viewer"
            className="absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize"
            style={{ left: workWidth != null && frameWidth > 0 ? `${(workWidth / frameWidth) * 100}%` : "50%" }}
            onPointerDown={drag}
            onDoubleClick={reset}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
          </div>
        )}
      </div>
    </div>
  );
}

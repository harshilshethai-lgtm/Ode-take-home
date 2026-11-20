import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Filter, Search, X } from "lucide-react";
import { AssignMenu, eligiblePeople, firstName } from "@/components/AssignMenu";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FlagIcons } from "@/components/ui/flag-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Kbd } from "@/components/ui/kbd";
import { PageTitle } from "@/components/ui/page-title";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PropertyList } from "@/components/ui/property-list";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { PEOPLE } from "@/data/people";
import { buildCaseRecord } from "@/domain/caseRecord";
import { memberIdFor } from "@/domain/memberId";
import { phoneForProvider } from "@/domain/outreach";
import { normalizeProvider } from "@/domain/providers";
import { STATUSES } from "@/domain/statuses";
import { cn } from "@/lib/cn";
import type { Order, Person } from "@/domain/types";
import { DEMO_NOW, SUBMIT_BY_HINT, parseDemoInstant } from "@/lib/demoClock";
import { fmtDob, fmtTableDate } from "@/lib/format";
import { CHANNEL_LABEL, label } from "@/lib/labels";
import { eligibilityFor } from "@/lib/mocks/eligibility";
import { usePersona } from "@/lib/persona";
import { useOrders } from "@/lib/useWorklistState";
import {
  byDue,
  closedColumns,
  criteriaScore,
  duePrimary,
  inView,
  insurerColumns,
  matchesPolicy,
  matchesSearch,
  nextStep,
  queueMeter,
  scanCaption,
  studyLine,
  toRow,
  VIEWS,
  type Row,
  type ViewId,
} from "@/lib/worklist";
import { parseWorklistUrl, serializeWorklistUrl, type SortDir, type SortKey, type WorklistUrlState } from "@/lib/worklistQuery";

const PERSONA_DEFAULT_VIEW: Record<Person["role"], ViewId> = {
  coordinator: "admin",
  nurse: "clinical",
  rules_admin: "clinical",
};

const PAGE_SIZES = [10, 25, 50] as const;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

function textOf(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Empty values stay at the bottom in both directions. */
function cmpText(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  const av = textOf(a).toLowerCase();
  const bv = textOf(b).toLowerCase();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const n = av.localeCompare(bv);
  return dir === "asc" ? n : -n;
}

function cmpNum(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

const SCROLL_PREFIX = "halcyon.worklist.scroll:";

export default function Worklist() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { orders, assign, reset } = useOrders();
  const { me } = usePersona();
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fallbackView = PERSONA_DEFAULT_VIEW[me.role];
  const url = parseWorklistUrl(params, fallbackView);
  const view = url.view;
  const statusFilter = url.status;
  const reasonFilter = url.reason;
  const hideWaiting = url.hideWaiting;
  const insurerFilter = url.insurer;
  const policyFilter = url.policy;
  const query = url.q;
  const page = url.page;
  const sort = useMemo(() => ({ key: url.sort, dir: url.dir }), [url.sort, url.dir]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);

  function commit(patch: Partial<WorklistUrlState>) {
    setParams(
      (prev) => {
        const current = parseWorklistUrl(prev, fallbackView);
        return serializeWorklistUrl({ ...current, ...patch }, fallbackView);
      },
      { replace: true },
    );
  }

  const rows = useMemo(() => orders.map((o) => toRow(o)), [orders]);

  const facts = useMemo(() => {
    const map = new Map<string, PatientFacts>();
    for (const order of orders) map.set(order.id, factsFor(order));
    return map;
  }, [orders]);
  const viewer = useMemo(() => ({ id: me.id, role: me.role }), [me.id, me.role]);

  const visible = useMemo(() => {
    const filtered = rows
      .filter((r) => (policyFilter ? !r.closed && matchesPolicy(r.order.policyRef, policyFilter) : inView(r, view, DEMO_NOW, viewer)))
      .filter((r) => (statusFilter ? r.order.status === statusFilter : true))
      .filter((r) => (reasonFilter ? r.reasonChip === reasonFilter : true))
      .filter((r) => (hideWaiting ? !r.waiting : true))
      .filter((r) => (insurerFilter ? r.order.insurer === insurerFilter : true))
      .filter((r) => matchesSearch(r, query));
    const assigneeName = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? "";
    const dir = sort.dir;
    return filtered.sort((a, b) => {
      switch (sort.key) {
        case "patient":
          return cmpText(a.order.patient?.name, b.order.patient?.name, dir);
        case "status":
          return cmpText(STATUSES[a.order.status].label, STATUSES[b.order.status].label, dir);
        case "insurance":
          return cmpText(a.order.insurer, b.order.insurer, dir);
        case "study":
          return cmpText(a.order.study, b.order.study, dir);
        case "due":
        case "appointment":
          return dir === "asc" ? byDue(a, b) : byDue(b, a);
        case "provider":
          return cmpText(facts.get(a.order.id)?.provider, facts.get(b.order.id)?.provider, dir);
        case "reason":
          return cmpText(nextStep(a).text, nextStep(b).text, dir);
        case "type":
          return cmpText(a.order.channel ? label(CHANNEL_LABEL, a.order.channel) : "", b.order.channel ? label(CHANNEL_LABEL, b.order.channel) : "", dir);
        case "urgency":
          return cmpText(a.order.priority === "Urgent" ? "Urgent" : "", b.order.priority === "Urgent" ? "Urgent" : "", dir);
        case "received":
          return cmpNum(new Date(a.order.statusSince).getTime(), new Date(b.order.statusSince).getTime(), dir);
        case "assignee":
          return cmpText(assigneeName(a.order.assigneeId), assigneeName(b.order.assigneeId), dir);
      }
    });
  }, [rows, view, statusFilter, reasonFilter, hideWaiting, insurerFilter, policyFilter, query, sort, facts, viewer]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== safePage) commit({ page: safePage });
  }, [page, safePage]);
  const pageRows = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const inScope = useMemo(() => rows.filter((r) => inView(r, view, DEMO_NOW, viewer)), [rows, view, viewer]);
  const statusOptions = useMemo(
    () => [...new Set(inScope.map((r) => r.order.status))].map((id) => ({ id: id as string, label: STATUSES[id].label })),
    [inScope],
  );
  const reasonQueue = view === "admin" || view === "clinical";
  const reasonOptions = useMemo(
    () => [...new Set(inScope.map((r) => r.reasonChip).filter((chip): chip is string => !!chip))].map((chip) => ({ id: chip, label: chip })),
    [inScope],
  );
  const insurerOptions = useMemo(
    () => [...new Set(inScope.map((r) => r.order.insurer).filter((v): v is string => !!v))].sort(),
    [inScope],
  );

  const selectedRows = visible.filter((r) => selected.has(r.order.id));
  const bulkPeople = useMemo(() => {
    const roles = [...new Set(selectedRows.map((r) => r.ownerRole))];
    if (selectedRows.length === 0 || roles.includes("system")) return [];
    const lists = roles.map((r) => new Set(eligiblePeople(r).map((p) => p.id)));
    return PEOPLE.filter((p) => lists.every((l) => l.has(p.id)));
  }, [selectedRows]);
  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.order.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function changeView(v: ViewId) {
    commit({ view: v, status: null, reason: null, insurer: null, policy: null, hideWaiting: false, page: 0 });
    setSelected(new Set());
    setCursor(null);
  }

  function toggleSort(key: SortKey) {
    commit({
      sort: key,
      dir: sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : "asc",
      page: 0,
    });
  }

  const prevPersonaId = useRef(me.id);
  useEffect(() => {
    if (prevPersonaId.current === me.id) return;
    prevPersonaId.current = me.id;
    changeView(PERSONA_DEFAULT_VIEW[me.role]);
  }, [me.id, me.role]);

  const searchKey = params.toString();
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const key = `${SCROLL_PREFIX}${searchKey}`;
    const saved = readScroll(key);
    if (saved != null) el.scrollTop = saved;
    const save = () => writeScroll(key, el.scrollTop);
    el.addEventListener("scroll", save, { passive: true });
    return () => {
      save();
      el.removeEventListener("scroll", save);
    };
  }, [searchKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const idx = visible.findIndex((r) => r.order.id === cursor);
      const move = (to: number) => {
        if (visible.length === 0) return;
        const at = Math.min(Math.max(to, 0), visible.length - 1);
        const row = visible[at];
        setCursor(row.order.id);
        commit({ page: Math.floor(at / pageSize) });
        requestAnimationFrame(() => {
          document.querySelector(`[data-row-key="${row.order.id}"]`)?.scrollIntoView({ block: "nearest" });
        });
      };
      switch (e.key.toLowerCase()) {
        case "j":
          move(idx + 1);
          break;
        case "k":
          move(idx < 0 ? 0 : idx - 1);
          break;
        case "enter":
          if (idx >= 0) navigate(`/case/${visible[idx].order.id}`);
          break;
        case "escape":
          setCursor(null);
          setSelected(new Set());
          break;
        case "a":
          if (idx >= 0 && eligiblePeople(visible[idx].ownerRole).some((p) => p.id === me.id)) {
            assign([visible[idx].order.id], me.id);
          }
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor, view, me.id, navigate, assign, pageSize]);

  const sortHeader = (key: SortKey, title: string) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 text-caption text-fg-2 hover:text-fg">
      {title}
      {sort.key === key ? sort.dir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : <ChevronsUpDown size={14} className="text-fg-3" />}
    </button>
  );

  const selectPage = (
    <input
      type="checkbox"
      aria-label="Select page"
      checked={allSelected}
      onChange={() =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const row of pageRows) {
            if (allSelected) next.delete(row.order.id);
            else next.add(row.order.id);
          }
          return next;
        })
      }
      onClick={(e) => e.stopPropagation()}
      className={cn("absolute -left-4 accent-accent xl:-left-6", selected.size === 0 && "opacity-0 group-hover/table:opacity-100 focus-visible:opacity-100")}
    />
  );

  const rowCheck = (row: Row) => (
    <input
      type="checkbox"
      aria-label={`Select ${row.order.patient?.name ?? "unmatched document"}`}
      checked={selected.has(row.order.id)}
      onChange={() => toggle(row.order.id)}
      onClick={(e) => e.stopPropagation()}
      className="absolute -left-4 accent-accent opacity-0 checked:opacity-100 group-hover:opacity-100 xl:-left-6"
    />
  );

  const withCheck = (column: Column<Row>): Column<Row> => ({
    ...column,
    headerCell: (
      <span className="relative inline-flex items-center">
        {selectPage}
        {column.headerCell ?? column.header}
      </span>
    ),
    cell: (row) => (
      <span className={cn("relative flex items-center", column.fit === "shrink" ? "min-w-0" : "w-max")}>
        {rowCheck(row)}
        {column.cell(row)}
      </span>
    ),
  });

  const dueColumn: Column<Row> = {
    id: "due",
    header: "Due",
    fit: "content",
    headerCell: (
      <Tip content={SUBMIT_BY_HINT}>
        <span>{sortHeader("due", "Due")}</span>
      </Tip>
    ),
    cell: (row) => <DueCell row={row} />,
  };
  const patientColumn: Column<Row> = {
    id: "patient",
    header: "Patient",
    fit: "content",
    headerCell: sortHeader("patient", "Patient"),
    cell: (row) => <PatientCell row={row} facts={facts.get(row.order.id)} />,
  };
  const nextColumn: Column<Row> = {
    id: "next",
    header: "Next step",
    fit: "shrink",
    headerCell: sortHeader("reason", "Next step"),
    cell: (row) => <NextStepCell row={row} />,
  };
  const studyColumn: Column<Row> = {
    id: "study",
    header: "Study",
    fit: "content",
    headerCell: sortHeader("study", "Study"),
    cell: (row) => {
      const text = studyLine(row.order);
      if (!text) return null;
      return (
        <Tip content={`${text}. ${EPIC_CHECKED}`}>
          <span>{text}</span>
        </Tip>
      );
    },
  };
  const insurerColumn: Column<Row> = {
    id: "insurer",
    header: "Insurer",
    fit: "content",
    headerCell: sortHeader("insurance", "Insurer"),
    cell: (row) => <InsurerCell row={row} />,
  };
  const statusColumn: Column<Row> = {
    id: "status",
    header: "Status",
    fit: "content",
    headerCell: sortHeader("status", "Status"),
    cell: (row) => (
      <Tip content={row.order.reason}>
        <span>
          <StatusPill status={row.order.status} channel={row.order.channel} reasonCode={row.order.reasonCode} label={row.order.statusLabel} />
        </span>
      </Tip>
    ),
  };
  const ownerColumn: Column<Row> = {
    id: "owner",
    header: "Owner",
    fit: "content",
    headerCell: sortHeader("assignee", "Owner"),
    cell: (row) => {
      const canAssign = eligiblePeople(row.ownerRole).some((person) => person.id === me.id);
      const menu = (
        <span className="inline-flex max-w-full" onClick={(e) => e.stopPropagation()}>
          <AssignMenu role={row.ownerRole} assigneeId={row.order.assigneeId} me={me} closed={row.closed} onAssign={(pid) => assign([row.order.id], pid)} />
        </span>
      );
      return canAssign ? (
        <Tip content="Assign to me" shortcut="A">
          {menu}
        </Tip>
      ) : (
        menu
      );
    },
  };
  const queueColumn: Column<Row> = {
    id: "queue",
    header: "In queue",
    fit: "content",
    headerCell: sortHeader("received", "In queue"),
    cell: (row) => {
      const meter = queueMeter(row);
      return (
        <Tip content={parseDemoInstant(row.order.statusSince).toISOString()}>
          <span className={cn("tabular", meter.over && "text-bad")}>{meter.text}</span>
        </Tip>
      );
    },
  };
  const criteriaColumn: Column<Row> = {
    id: "criteria",
    header: "Criteria",
    fit: "content",
    cell: (row) => <CriteriaMeter score={facts.get(row.order.id)?.criteria ?? null} />,
  };

  const referenceColumn = (): Column<Row> => ({
    id: "reference",
    header: "Reference",
    fit: "content",
    cell: (row) => {
      const reference = insurerColumns(row).reference;
      return reference ? <span className="font-mono text-caption">{reference}</span> : null;
    },
  });
  const waitingColumn = (): Column<Row> => ({
    id: "waiting",
    header: "With insurer for",
    fit: "content",
    headerCell: sortHeader("received", "With insurer for"),
    cell: (row) => <span className="tabular">{insurerColumns(row).waiting}</span>,
  });
  const lastCheckColumn = (): Column<Row> => ({
    id: "check",
    header: "Last check",
    fit: "content",
    cell: (row) => {
      const check = insurerColumns(row);
      if (!check.lastCheck) return null;
      return <span className={cn("tabular", check.overdue && "text-bad")}>{check.lastCheck}</span>;
    },
  });
  const latestColumn = (): Column<Row> => ({
    id: "answer",
    header: "Latest answer",
    fit: "content",
    cell: (row) => <span>{insurerColumns(row).latest}</span>,
  });
  const outcomeColumn = (): Column<Row> => ({
    id: "outcome",
    header: "Outcome",
    fit: "content",
    headerCell: sortHeader("status", "Outcome"),
    cell: (row) => <span>{closedColumns(row.order).outcome}</span>,
  });
  const authColumn = (): Column<Row> => ({
    id: "auth",
    header: "Auth #",
    fit: "content",
    cell: (row) => {
      const auth = closedColumns(row.order).auth;
      return auth ? <span className="font-mono text-caption">{auth}</span> : <span className="text-fg-3">—</span>;
    },
  });
  const validColumn = (): Column<Row> => ({
    id: "valid",
    header: "Valid through",
    fit: "content",
    cell: (row) => {
      const valid = closedColumns(row.order).validThrough;
      return valid ? <span className="tabular">{valid}</span> : <span className="text-fg-3">—</span>;
    },
  });
  const closedOnColumn = (): Column<Row> => ({
    id: "closed",
    header: "Closed",
    fit: "content",
    headerCell: sortHeader("received", "Closed"),
    cell: (row) => <span className="tabular text-fg-2">{fmtTableDate(parseDemoInstant(row.order.statusSince))}</span>,
  });

  const queueColumns = [dueColumn, patientColumn, nextColumn, studyColumn, insurerColumn, ownerColumn, queueColumn];
  const columns: Column<Row>[] = (
    view === "with_insurer"
      ? [dueColumn, patientColumn, studyColumn, insurerColumn, referenceColumn(), waitingColumn(), lastCheckColumn(), latestColumn()]
      : view === "closed"
        ? [patientColumn, studyColumn, insurerColumn, outcomeColumn(), authColumn(), validColumn(), closedOnColumn()]
        : view === "clinical"
          ? [dueColumn, patientColumn, nextColumn, studyColumn, insurerColumn, criteriaColumn, ownerColumn, queueColumn]
          : view === "all"
            ? [dueColumn, patientColumn, statusColumn, nextColumn, studyColumn, insurerColumn, ownerColumn, queueColumn]
            : queueColumns
  ).map((column, index) => (index === 0 ? withCheck(column) : column));


  const openCount = rows.filter((r) => !r.closed).length;
  const from = visible.length === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(visible.length, (safePage + 1) * pageSize);

  return (
    <main aria-keyshortcuts="j k Enter a" className="flex h-full min-h-0 min-w-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-4 px-6 pt-6">
        <PageTitle count={openCount}>Worklist</PageTitle>
        <Button variant="ghost" className="ml-auto" onClick={() => { reset(); setSelected(new Set()); }}>
          Reset demo data
        </Button>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        {selectedRows.length > 0 ? (
          <>
            <span className="text-body text-fg">{selectedRows.length} selected</span>
            {bulkPeople.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button>
                    Assign <ChevronDown size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  {bulkPeople.map((p) => (
                    <MenuItem
                      key={p.id}
                      onClick={() => {
                        assign(
                          selectedRows.map((r) => r.order.id),
                          p.id,
                        );
                        setSelected(new Set());
                      }}
                    >
                      <Avatar name={p.name} />
                      {firstName(p)}
                      {p.id === me.id && <span className="ml-auto text-caption text-fg-3">me</span>}
                    </MenuItem>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </>
        ) : (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-3" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => commit({ q: e.target.value, page: 0 })}
                onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), commit({ q: "", page: 0 }))}
                placeholder="Search by name, birthdate"
                aria-label="Search by name, birthdate"
                aria-keyshortcuts="/"
                className="h-7 w-72 rounded-md border border-line bg-panel pl-8 pr-8 text-body text-fg outline-none placeholder:text-fg-3 focus:border-accent-fg"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                <Kbd>/</Kbd>
              </span>
            </div>
            <FilterMenu
              title={reasonQueue ? "Reason" : "Status"}
              value={reasonQueue ? reasonFilter : statusFilter}
              options={reasonQueue ? reasonOptions : statusOptions}
              onChange={(id) => {
                if (reasonQueue) commit({ reason: id, page: 0 });
                else commit({ status: id, page: 0 });
              }}
              insurer={insurerFilter}
              insurerOptions={insurerOptions}
              onInsurer={(id) => commit({ insurer: id, page: 0 })}
            />
            {view === "admin" && (
              <Button variant="secondary" aria-pressed={hideWaiting} onClick={() => commit({ hideWaiting: !hideWaiting, page: 0 })}>
                {hideWaiting ? "Waiting hidden" : "Hide waiting"}
              </Button>
            )}
            {(statusFilter || reasonFilter || insurerFilter || policyFilter) && (
              <span className="ml-1 flex items-center gap-1">
                {statusFilter && (
                  <RemovableChip onRemove={() => commit({ status: null })}>
                    {label(Object.fromEntries(statusOptions.map((o) => [o.id, o.label])), statusFilter)}
                  </RemovableChip>
                )}
                {reasonFilter && <RemovableChip onRemove={() => commit({ reason: null })}>{reasonFilter}</RemovableChip>}
                {insurerFilter && <RemovableChip onRemove={() => commit({ insurer: null })}>{insurerFilter}</RemovableChip>}
                {policyFilter && <RemovableChip onRemove={() => commit({ policy: null })}>{policyFilter}</RemovableChip>}
              </span>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 overflow-x-auto px-6">
        <Tabs tabs={VIEWS.map((v) => ({ ...v, count: rows.filter((r) => inView(r, v.id, DEMO_NOW, viewer)).length }))} value={view} onChange={changeView} />
      </div>

      <div ref={scrollerRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
        {view === "with_insurer" ? (
          <div>
            {(["Awaiting", "Pended", "Appeal"] as const).map((group) => {
              const grouped = visible.filter((row) => insurerBucket(row.order.reasonCode) === group);
              return (
                <section key={group}>
                  <div className="px-6 pt-4 text-caption text-fg-2">
                    {group} {grouped.length}
                  </div>
                  {grouped.length > 0 && (
                    <DataTable
                      comfortable
                      compact
                      className="w-full xl:w-max xl:min-w-full"
                      columns={columns}
                      rows={grouped}
                      getKey={(r) => r.order.id}
                      selectedKey={cursor}
                      onRowClick={(r) => navigate(`/case/${r.order.id}`)}
                      empty="Nothing here"
                    />
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <DataTable
            comfortable
            compact
            className="w-full xl:w-max xl:min-w-full"
            columns={columns}
            rows={pageRows}
            getKey={(r) => r.order.id}
            selectedKey={cursor}
            onRowClick={(r) => navigate(`/case/${r.order.id}`)}
            empty="Nothing here"
          />
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-6">
        <label className="flex items-center gap-2 text-caption text-fg-2">
          Show
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
              commit({ page: 0 });
            }}
            className="h-7 rounded-md border border-line bg-panel px-2 text-body text-fg outline-none"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1">
          <span className="tabular text-caption text-fg-2">
            {from}–{to} of {visible.length}
          </span>
          <Button variant="ghost" aria-label="Previous page" disabled={safePage === 0} onClick={() => commit({ page: safePage - 1 })}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => commit({ page: safePage + 1 })}>
            <ChevronRight size={16} />
          </Button>
        </span>
      </div>
    </main>
  );
}

function readScroll(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeScroll(key: string, value: number) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // Private mode can refuse storage. The list still works.
  }
}

function insurerBucket(reason: string | null): "Awaiting" | "Pended" | "Appeal" {
  if (reason === "PENDED_BY_INSURER") return "Pended";
  if (reason === "APPEAL") return "Appeal";
  return "Awaiting";
}

const EPIC_CHECKED = `Epic · checked ${fmtTableDate(DEMO_NOW)}`;

interface PatientFacts {
  provider: string | null;
  providerPhone: string | null;
  memberId: string | null;
  policy: string | null;
  criteria: { met: number; total: number } | null;
  channel: string | null;
}

function factsFor(order: Order): PatientFacts {
  const record = buildCaseRecord(order);
  const provider = record.elements.find((element) => element.label === "Ordering provider");
  const name = provider?.value ? normalizeProvider(provider.value.split(" · ")[0] ?? provider.value).detail : null;
  return {
    provider: name,
    providerPhone: phoneForProvider(name),
    memberId: memberIdFor(order)?.value ?? eligibilityFor(order.patient?.mrn)?.memberId ?? null,
    policy: record.policyLabel ?? order.policyRef,
    criteria: criteriaScore(record.criteria),
    channel: order.channel ? label(CHANNEL_LABEL, order.channel) : null,
  };
}

function ScanLine({ text }: { text: string }) {
  const time = text.match(/^(.*) (\d{1,2}:\d{2} [AP]M)$/);
  return (
    <>
      <span className="block text-caption text-fg-3 xl:hidden">
        {time ? (
          <>
            <span className="block whitespace-nowrap">{time[1]}</span>
            <span className="block whitespace-nowrap">{time[2]}</span>
          </>
        ) : (
          <span className="block whitespace-nowrap">{text}</span>
        )}
      </span>
      <span className="hidden whitespace-nowrap text-caption text-fg-3 xl:block">{text}</span>
    </>
  );
}

function DueCell({ row }: { row: Row }) {
  const primary = duePrimary(row);
  const scan = scanCaption(row);
  const urgent = row.order.priority !== "Routine";
  const tip = [primary.text, scan, row.order.scheduleHandwritten ? "Handwritten" : "", SUBMIT_BY_HINT].filter(Boolean).join(". ");
  return (
    <Tip content={tip}>
      <span className="block leading-4">
        <span className="inline-flex items-center gap-2">
          <span className={cn("tabular whitespace-nowrap", primary.past && "text-bad")}>{primary.text}</span>
          {urgent && <Chip>{row.order.priority}</Chip>}
        </span>
        {scan && <ScanLine text={scan} />}
      </span>
    </Tip>
  );
}

function NextStepCell({ row }: { row: Row }) {
  const step = nextStep(row);
  if (!step.text && row.flags.length === 0) return null;
  return (
    <span className="flex items-center gap-2 max-xl:min-w-0">
      {row.flags.length > 0 && (
        <span className="shrink-0">
          <FlagIcons flags={row.flags} />
        </span>
      )}
      <Tip content={step.tip}>
        <span className="block whitespace-nowrap max-xl:min-w-0 max-xl:truncate">{step.text}</span>
      </Tip>
    </span>
  );
}

function InsurerCell({ row }: { row: Row }) {
  const order = row.order;
  if (!order.insurer) return null;
  const channel = order.channel ? label(CHANNEL_LABEL, order.channel) : null;
  const tip = [order.insurer, order.plan, channel].filter(Boolean).join(" · ");
  return (
    <Tip content={`${tip}. ${EPIC_CHECKED}`}>
      <span className="block leading-4">
        <span className="block whitespace-nowrap">{order.insurer}</span>
        {(order.plan || channel) && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-fg-2">
            {order.plan}
            {channel && <Chip>{channel}</Chip>}
          </span>
        )}
      </span>
    </Tip>
  );
}

function CriteriaMeter({ score }: { score: { met: number; total: number } | null }) {
  if (!score) return <span className="text-fg-3">—</span>;
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${score.met} of ${score.total}`}>
      <span className="inline-flex gap-1" aria-hidden>
        {Array.from({ length: score.total }, (_, index) => (
          <span key={index} className={cn("size-2 rounded-md", index < score.met ? "bg-fg" : "bg-chip")} />
        ))}
      </span>
      <span className="tabular">
        {score.met}/{score.total}
      </span>
    </span>
  );
}

function PatientCell({ row, facts }: { row: Row; facts: PatientFacts | undefined }) {
  const patient = row.order.patient;
  if (!patient) return <span className="text-fg-2">Unmatched</span>;
  const dob = fmtDob(patient.dob);
  const provider = [facts?.provider, facts?.providerPhone].filter(Boolean).join(" · ");
  const criteria = facts?.criteria ? `${facts.criteria.met}/${facts.criteria.total}` : null;
  return (
    <span className="block leading-4">
      <HoverCard openDelay={300} closeDelay={80}>
        <HoverCardTrigger asChild>
          <Link to={`/case/${row.order.id}`} className="block whitespace-nowrap font-medium text-fg" onClick={(e) => e.stopPropagation()}>
            {patient.name}
          </Link>
        </HoverCardTrigger>
        <HoverCardContent onClick={(e) => e.stopPropagation()}>
          <PropertyList
            items={[
              { label: "Ordering provider", value: provider || null },
              { label: "Member ID", value: facts?.memberId ? <span className="font-mono">{facts.memberId}</span> : null },
              { label: "Policy", value: facts?.policy ?? null },
              { label: "Criteria", value: criteria ? <span className="tabular">{criteria}</span> : null },
              { label: "Channel", value: facts?.channel ?? null },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-2 text-caption text-fg-2">
            <span className="inline-flex items-center gap-1">
              Move <Kbd>J</Kbd>
              <Kbd>K</Kbd>
            </span>
            <span className="inline-flex items-center gap-1">
              Open <Kbd>Enter</Kbd>
            </span>
            <span className="inline-flex items-center gap-1">
              Assign <Kbd>A</Kbd>
            </span>
          </div>
        </HoverCardContent>
      </HoverCard>
      <span className="block whitespace-nowrap font-mono text-caption text-fg-2 xl:hidden">
        <span className="block">{dob}</span>
        <span className="block">{patient.mrn}</span>
      </span>
      <span className="hidden whitespace-nowrap font-mono text-caption text-fg-2 xl:block">
        {dob} · {patient.mrn}
      </span>
    </span>
  );
}

function FilterMenu({
  title,
  value,
  options,
  onChange,
  insurer,
  insurerOptions,
  onInsurer,
}: {
  title: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (id: string | null) => void;
  insurer: string | null;
  insurerOptions: string[];
  onInsurer: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="default">
          <Filter size={14} />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-64 overflow-auto">
        <div className="px-2 py-1 text-caption text-fg-2">{title}</div>
        {options.length === 0 && <div className="px-2 py-1 text-body text-fg-2">Nothing to filter</div>}
        {options.map((o) => (
          <MenuItem
            key={o.id}
            selected={o.id === value}
            onClick={() => {
              onChange(o.id === value ? null : o.id);
              setOpen(false);
            }}
          >
            <span className="flex size-4 items-center justify-center">{o.id === value && <Check size={14} />}</span>
            {o.label}
          </MenuItem>
        ))}
        <div className="mt-1 border-t border-line px-2 py-1 text-caption text-fg-2">Insurance</div>
        {insurerOptions.length === 0 && <div className="px-2 py-1 text-body text-fg-2">Nothing to filter</div>}
        {insurerOptions.map((name) => (
          <MenuItem
            key={name}
            selected={name === insurer}
            onClick={() => {
              onInsurer(name === insurer ? null : name);
              setOpen(false);
            }}
          >
            <span className="flex size-4 items-center justify-center">{name === insurer && <Check size={14} />}</span>
            {name}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function RemovableChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <Chip className="gap-1 pr-1">
      {children}
      <button type="button" aria-label="Remove filter" onClick={onRemove} className="text-fg-3 hover:text-fg">
        <X size={14} />
      </button>
    </Chip>
  );
}

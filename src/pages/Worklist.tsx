import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, CircleCheck, Filter, Info, Search, X } from "lucide-react";
import { AssignMenu, eligiblePeople, firstName } from "@/components/AssignMenu";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FlagIcons } from "@/components/ui/flag-icons";
import { Kbd } from "@/components/ui/kbd";
import { PageTitle } from "@/components/ui/page-title";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { PEOPLE } from "@/data/people";
import { DEMO_NOW } from "@/data/orders";
import { buildCaseRecord } from "@/domain/caseRecord";
import { STATUSES } from "@/domain/statuses";
import { cn } from "@/lib/cn";
import type { Person } from "@/domain/types";
import { fmtCountdown, fmtDob, fmtTableDate } from "@/lib/format";
import { CHANNEL_LABEL, SIDE_SHORT, label } from "@/lib/labels";
import { usePersona } from "@/lib/persona";
import { useOrders } from "@/lib/useWorklistState";
import { bySchedule, inView, matchesSearch, toRow, VIEWS, type Row, type ViewId } from "@/lib/worklist";

const PERSONA_DEFAULT_VIEW: Record<Person["role"], ViewId> = {
  coordinator: "admin",
  nurse: "clinical",
  rules_admin: "clinical",
};

const PAGE_SIZES = [10, 25, 50] as const;

type SortKey = "patient" | "status" | "reason" | "insurance" | "study" | "appointment" | "provider" | "type" | "urgency" | "received" | "assignee";
type SortDir = "asc" | "desc";

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

export default function Worklist() {
  const navigate = useNavigate();
  const { orders, assign, reset } = useOrders();
  const { me } = usePersona();
  const searchRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<ViewId>(PERSONA_DEFAULT_VIEW[me.role]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [hideWaiting, setHideWaiting] = useState(false);
  const [insurerFilter, setInsurerFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "appointment", dir: "asc" });

  const rows = useMemo(() => orders.map((o) => toRow(o)), [orders]);

  const providers = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const order of orders) {
      const value = buildCaseRecord(order).elements.find((element) => element.label === "Ordering provider")?.value ?? null;
      map.set(order.id, value ? value.split(" · ")[0] : null);
    }
    return map;
  }, [orders]);

  const visible = useMemo(() => {
    const filtered = rows
      .filter((r) => inView(r, view))
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
        case "appointment":
          return dir === "asc" ? bySchedule(a, b) : bySchedule(b, a);
        case "provider":
          return cmpText(providers.get(a.order.id), providers.get(b.order.id), dir);
        case "reason":
          return cmpText(a.reasonChip ?? a.stepText, b.reasonChip ?? b.stepText, dir);
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
  }, [rows, view, statusFilter, reasonFilter, hideWaiting, insurerFilter, query, sort, providers]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const pageRows = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const inScope = useMemo(() => rows.filter((r) => inView(r, view)), [rows, view]);
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
    setView(v);
    setSelected(new Set());
    setStatusFilter(null);
    setReasonFilter(null);
    setHideWaiting(false);
    setInsurerFilter(null);
    setCursor(null);
    setPage(0);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(0);
  }

  const prevPersonaId = useRef(me.id);
  useEffect(() => {
    if (prevPersonaId.current === me.id) return;
    prevPersonaId.current = me.id;
    changeView(PERSONA_DEFAULT_VIEW[me.role]);
  }, [me.id, me.role]);

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
        setPage(Math.floor(at / pageSize));
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

  const columns: Column<Row>[] = [
    {
      id: "patient",
      header: "Patient",
      width: "min-w-44",
      headerCell: (
        <span className="relative inline-flex items-center">
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
            className={cn("absolute -left-6 accent-accent", selected.size === 0 && "opacity-0 group-hover/table:opacity-100 focus-visible:opacity-100")}
          />
          {sortHeader("patient", "Patient")}
        </span>
      ),
      cell: (r) => {
        const patient = r.order.patient;
        return (
          <span className="relative block">
            <input
              type="checkbox"
              aria-label={`Select ${patient?.name ?? "unmatched document"}`}
              checked={selected.has(r.order.id)}
              onChange={() => toggle(r.order.id)}
              onClick={(e) => e.stopPropagation()}
              className="absolute -left-6 top-1 accent-accent opacity-0 checked:opacity-100 group-hover:opacity-100"
            />
            {patient ? (
              <span className="min-w-0">
                <span className="flex items-center gap-1">
                  <span className="whitespace-nowrap font-medium text-accent-fg">{patient.name}</span>
                  <Tip content={<span className="font-mono">{patient.mrn}</span>}>
                    <button type="button" aria-label={`Record number for ${patient.name}`} onClick={(e) => e.stopPropagation()} className="text-fg-3 hover:text-fg">
                      <Info size={14} />
                    </button>
                  </Tip>
                  <FlagIcons flags={r.flags} />
                </span>
                <span className="tabular block text-caption text-fg-2">{fmtDob(patient.dob)}</span>
              </span>
            ) : (
              <span className="text-fg-3">Unmatched</span>
            )}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      headerCell: sortHeader("status", "Status"),
      cell: (r) => <StatusPill status={r.order.status} channel={r.order.channel} reasonCode={r.order.reasonCode} />,
    },
    {
      id: "reason",
      header: "Reason",
      headerCell: sortHeader("reason", "Reason"),
      cell: (r) => <ReasonCell row={r} />,
    },
    {
      id: "insurance",
      header: "Insurance",
      width: "max-w-52",
      headerCell: sortHeader("insurance", "Insurance"),
      cell: (r) => {
        const text = [r.order.insurer, r.order.plan].filter(Boolean).join(" · ");
        if (!text) return <span className="text-fg-3">—</span>;
        return (
          <Tip content={text}>
            <span className="inline-flex max-w-52 items-center gap-2">
              <CircleCheck size={14} className="shrink-0 text-good" />
              <span className="truncate">{text}</span>
            </span>
          </Tip>
        );
      },
    },
    {
      id: "study",
      header: "Study",
      headerCell: sortHeader("study", "Study"),
      cell: (r) => (
        <span>
          {r.order.study}
          {r.order.side && <span className="text-fg-2"> · {label(SIDE_SHORT, r.order.side)}</span>}
        </span>
      ),
    },
    {
      id: "appointment",
      header: "Appointment",
      headerCell: sortHeader("appointment", "Appointment"),
      cell: (r) =>
        r.order.scheduledAt ? (
          <span className="tabular">{fmtTableDate(new Date(r.order.scheduledAt))}</span>
        ) : (
          <span className="text-fg-3">—</span>
        ),
    },
    {
      id: "provider",
      header: "Ordering provider",
      headerCell: sortHeader("provider", "Ordering provider"),
      cell: (r) => providers.get(r.order.id) ?? <span className="text-fg-3">—</span>,
    },
    {
      id: "type",
      header: "Type",
      headerCell: sortHeader("type", "Type"),
      cell: (r) => (r.order.channel ? label(CHANNEL_LABEL, r.order.channel) : <span className="text-fg-3">—</span>),
    },
    {
      id: "urgency",
      header: "Urgency",
      headerCell: sortHeader("urgency", "Urgency"),
      cell: (r) => (r.order.priority === "Urgent" ? <span className="font-medium text-bad">Urgent</span> : <span className="text-fg-3">—</span>),
    },
    {
      id: "scan-risk",
      header: "Scan at risk",
      cell: (r) =>
        r.flags.some((flag) => flag.id === "scan_at_risk") ? <span className="text-bad">At risk</span> : <span className="text-fg-3">—</span>,
    },
    {
      id: "received",
      header: "Received",
      headerCell: sortHeader("received", "Received"),
      cell: (r) => <span className="tabular text-fg-2">{fmtCountdown(new Date(r.order.statusSince), DEMO_NOW)}</span>,
    },
    {
      id: "assignee",
      header: "Assignee",
      width: "w-36",
      headerCell: sortHeader("assignee", "Assignee"),
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <AssignMenu role={r.ownerRole} assigneeId={r.order.assigneeId} me={me} closed={r.closed} onAssign={(pid) => assign([r.order.id], pid)} />
        </div>
      ),
    },
  ];

  const openCount = rows.filter((r) => !r.closed).length;
  const from = visible.length === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(visible.length, (safePage + 1) * pageSize);

  return (
    <main className="flex h-full min-h-0 flex-col bg-panel">
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
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQuery(""), setPage(0))}
                placeholder="Search by name, birthdate"
                aria-label="Search by name, birthdate"
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
                if (reasonQueue) setReasonFilter(id);
                else setStatusFilter(id);
                setPage(0);
              }}
              insurer={insurerFilter}
              insurerOptions={insurerOptions}
              onInsurer={(id) => {
                setInsurerFilter(id);
                setPage(0);
              }}
            />
            {view === "admin" && (
              <Button variant="secondary" aria-pressed={hideWaiting} onClick={() => { setHideWaiting((on) => !on); setPage(0); }}>
                {hideWaiting ? "Waiting hidden" : "Hide waiting"}
              </Button>
            )}
            {(statusFilter || reasonFilter || insurerFilter) && (
              <span className="ml-1 flex items-center gap-1">
                {statusFilter && (
                  <RemovableChip onRemove={() => setStatusFilter(null)}>
                    {label(Object.fromEntries(statusOptions.map((o) => [o.id, o.label])), statusFilter)}
                  </RemovableChip>
                )}
                {reasonFilter && <RemovableChip onRemove={() => setReasonFilter(null)}>{reasonFilter}</RemovableChip>}
                {insurerFilter && <RemovableChip onRemove={() => setInsurerFilter(null)}>{insurerFilter}</RemovableChip>}
              </span>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 px-6">
        <Tabs tabs={VIEWS.map((v) => ({ ...v, count: rows.filter((r) => inView(r, v.id)).length }))} value={view} onChange={changeView} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
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
                      className="min-w-max"
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
            className="min-w-max"
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
              setPage(0);
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
          <Button variant="ghost" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            <ChevronRight size={16} />
          </Button>
        </span>
      </div>
    </main>
  );
}

function insurerBucket(reason: string | null): "Awaiting" | "Pended" | "Appeal" {
  if (reason === "PENDED_BY_INSURER") return "Pended";
  if (reason === "APPEAL") return "Appeal";
  return "Awaiting";
}

function ReasonCell({ row }: { row: Row }) {
  if (row.stepText) return <span className="text-fg-3">{row.stepText}</span>;
  if (!row.reasonChip) return <span className="text-fg-3">—</span>;
  if (row.closed) return <span className="text-fg-3">{row.reasonChip}</span>;
  return (
    <Tip content={row.order.reason}>
      <span className="inline-flex flex-col items-start gap-1">
        <Chip>{row.reasonChip}</Chip>
        {row.waiting && row.order.waitingOn && <span className="text-caption text-fg-3">waiting on {row.order.waitingOn}</span>}
      </span>
    </Tip>
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

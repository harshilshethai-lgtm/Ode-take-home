import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
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
import { STATUSES } from "@/domain/statuses";
import { cn } from "@/lib/cn";
import type { Person } from "@/domain/types";
import { fmtDuration, fmtTableDate } from "@/lib/format";
import { SIDE_SHORT, label } from "@/lib/labels";
import { usePersona } from "@/lib/persona";
import { useOrders } from "@/lib/useWorklistState";
import { bySchedule, inView, matchesSearch, toRow, VIEWS, type Row, type ViewId } from "@/lib/worklist";

const PERSONA_DEFAULT_VIEW: Record<Person["role"], ViewId> = {
  coordinator: "coordinator",
  nurse: "nurse",
  rules_admin: "nurse",
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Matches DataTable: 32px header, 36px rows. */
const HEAD_HEIGHT = 32;
const ROW_HEIGHT = 36;

function rowsThatFit(height: number): number {
  const available = height - HEAD_HEIGHT;
  if (available < ROW_HEIGHT) return 1;
  return Math.floor(available / ROW_HEIGHT);
}

export default function Worklist() {
  const navigate = useNavigate();
  const { orders, assign } = useOrders();
  const { me } = usePersona();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<ViewId>(PERSONA_DEFAULT_VIEW[me.role]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [insurerFilter, setInsurerFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() =>
    typeof window === "undefined" ? 12 : rowsThatFit(Math.max(0, window.innerHeight - 220)),
  );

  const rows = useMemo(() => orders.map((o) => toRow(o)), [orders]);

  const visible = useMemo(
    () =>
      rows
        .filter((r) => inView(r, view))
        .filter((r) => (statusFilter ? r.order.status === statusFilter : true))
        .filter((r) => (insurerFilter ? r.order.insurer === insurerFilter : true))
        .filter((r) => matchesSearch(r, query))
        .sort(bySchedule),
    [rows, view, me, statusFilter, insurerFilter, query],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const pageRows = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = rowsThatFit(el.clientHeight);
      if (el.clientHeight < HEAD_HEIGHT + ROW_HEIGHT) return;
      setPageSize((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const inScope = useMemo(() => rows.filter((r) => inView(r, view)), [rows, view]);
  const statusOptions = useMemo(
    () => [...new Set(inScope.map((r) => r.order.status))].map((id) => ({ id: id as string, label: STATUSES[id].label })),
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
    setInsurerFilter(null);
    setCursor(null);
    setPage(0);
  }

  // Switching persona lands on that person's own queue.
  const prevPersonaId = useRef(me.id);
  useEffect(() => {
    if (prevPersonaId.current === me.id) return;
    prevPersonaId.current = me.id;
    changeView(PERSONA_DEFAULT_VIEW[me.role]);
  }, [me.id, me.role]);

  // Keyboard: J/K move, Enter opens, Esc clears, A assigns to me, / focuses search.
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

  const columns: Column<Row>[] = [
    {
      id: "select",
      header: "Select",
      width: "w-10",
      headerCell: (
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
          className="accent-accent"
        />
      ),
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={`Select ${r.order.patient?.name ?? "unmatched document"}`}
          checked={selected.has(r.order.id)}
          onChange={() => toggle(r.order.id)}
          onClick={(e) => e.stopPropagation()}
          className="accent-accent opacity-0 checked:opacity-100 group-hover:opacity-100"
        />
      ),
    },
    {
      id: "scan",
      header: "Scan",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.order.scheduledAt ? <span className="tabular">{fmtTableDate(new Date(r.order.scheduledAt))}</span> : <span className="text-fg-3">—</span>}
          <FlagIcons flags={r.flags} />
        </span>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      cell: (r) =>
        r.order.patient ? (
          <Tip content={<span className="font-mono">{r.order.patient.mrn}</span>}>
            <span className="font-medium text-fg">{r.order.patient.name}</span>
          </Tip>
        ) : (
          <span className="text-fg-3">Unmatched</span>
        ),
    },
    {
      id: "study",
      header: "Study",
      cell: (r) => (
        <span>
          {r.order.study}
          {r.order.side && <span className="text-fg-2"> · {label(SIDE_SHORT, r.order.side)}</span>}
        </span>
      ),
    },
    { id: "insurer", header: "Insurer", cell: (r) => r.order.insurer ?? <span className="text-fg-3">—</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <StatusPill status={r.order.status} channel={r.order.channel} confirmOnly={r.order.confirmOnly} linked={r.order.linkedApproval} />
          <span className={cn("tabular text-caption", r.overSla ? "text-amber-500" : "text-fg-3")}>{fmtDuration(r.minutesInStatus)}</span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (r) => (
        <Tip content={r.order.reason}>
          <span className="block max-w-64 truncate text-fg-2">{r.order.reason}</span>
        </Tip>
      ),
    },
    {
      id: "owner",
      header: "Owner",
      width: "w-40",
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <AssignMenu
            role={r.ownerRole}
            assigneeId={r.order.assigneeId}
            me={me}
            closed={r.closed}
            onAssign={(pid) => assign([r.order.id], pid)}
          />
        </div>
      ),
    },
  ];

  const openCount = rows.filter((r) => !r.closed).length;
  const filtersApplied = statusFilter || insurerFilter;

  const from = visible.length === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(visible.length, (safePage + 1) * pageSize);

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-wide flex-col p-6">
      <div className="mb-4 shrink-0">
        <PageTitle count={openCount}>Worklist</PageTitle>
      </div>

      <div className="shrink-0">
        <Tabs
          tabs={VIEWS.map((v) => ({ ...v, count: rows.filter((r) => inView(r, v.id)).length }))}
          value={view}
          onChange={changeView}
        />
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2">
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
                placeholder="Search"
                aria-label="Search"
                className="h-7 w-56 rounded-md border border-line bg-panel pl-8 pr-6 text-body text-fg outline-none placeholder:text-fg-3 focus:border-accent-fg"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                <Kbd>/</Kbd>
              </span>
            </div>
            <FilterButton
              title="Status"
              value={statusFilter}
              options={statusOptions}
              onChange={(id) => {
                setStatusFilter(id);
                setPage(0);
              }}
            />
            <FilterButton
              title="Insurer"
              value={insurerFilter}
              options={insurerOptions.map((i) => ({ id: i, label: i }))}
              onChange={(id) => {
                setInsurerFilter(id);
                setPage(0);
              }}
            />
            {filtersApplied && (
              <span className="ml-1 flex items-center gap-1">
                {statusFilter && (
                  <RemovableChip onRemove={() => setStatusFilter(null)}>{label(Object.fromEntries(statusOptions.map((o) => [o.id, o.label])), statusFilter)}</RemovableChip>
                )}
                {insurerFilter && <RemovableChip onRemove={() => setInsurerFilter(null)}>{insurerFilter}</RemovableChip>}
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
          <DataTable
            columns={columns}
            rows={pageRows}
            getKey={(r) => r.order.id}
            selectedKey={cursor}
            onRowClick={(r) => navigate(`/case/${r.order.id}`)}
            empty="Nothing here"
          />
        </div>
        <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-panel px-4">
          <span className="tabular text-caption text-fg-2">
            {from}–{to} of {visible.length}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft size={16} />
            </Button>
            <span className="tabular w-12 text-center text-caption text-fg-2">
              {safePage + 1} of {pageCount}
            </span>
            <Button variant="ghost" aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
              <ChevronRight size={16} />
            </Button>
          </span>
        </div>
      </div>
    </main>
  );
}

function FilterButton({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button>
          {title}
          <ChevronDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
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

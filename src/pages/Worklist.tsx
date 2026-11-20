import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { AssignMenu, eligiblePeople, firstName } from "@/components/AssignMenu";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FlagIcons } from "@/components/ui/flag-icons";
import { Kbd } from "@/components/ui/kbd";
import { PageTitle } from "@/components/ui/page-title";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusLabel } from "@/components/ui/status-dot";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { PEOPLE } from "@/data/people";
import { STATUSES } from "@/domain/statuses";
import type { Person } from "@/domain/types";
import { fmtDuration, fmtTableDate } from "@/lib/format";
import { SIDE_SHORT, label } from "@/lib/labels";
import { usePersona } from "@/lib/persona";
import { statusTone } from "@/lib/statusTone";
import { useOrders } from "@/lib/useWorklistState";
import { bySchedule, inView, matchesSearch, toRow, VIEWS, type Row, type ViewId } from "@/lib/worklist";

const PERSONA_DEFAULT_VIEW: Record<Person["role"], ViewId> = {
  coordinator: "mine",
  nurse: "mine",
  rules_admin: "mine",
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export default function Worklist() {
  const navigate = useNavigate();
  const { orders, assign } = useOrders();
  const { me } = usePersona();
  const searchRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<ViewId>(PERSONA_DEFAULT_VIEW[me.role]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [insurerFilter, setInsurerFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);

  const rows = useMemo(() => orders.map((o) => toRow(o)), [orders]);

  const visible = useMemo(
    () =>
      rows
        .filter((r) => inView(r, view, me))
        .filter((r) => (statusFilter ? r.order.status === statusFilter : true))
        .filter((r) => (insurerFilter ? r.order.insurer === insurerFilter : true))
        .filter((r) => matchesSearch(r, query))
        .sort(bySchedule),
    [rows, view, me, statusFilter, insurerFilter, query],
  );

  const inScope = useMemo(() => rows.filter((r) => inView(r, view, me)), [rows, view, me]);
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
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.order.id));

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
        const row = visible[Math.min(Math.max(to, 0), visible.length - 1)];
        if (!row) return;
        setCursor(row.order.id);
        document.querySelector(`[data-row-key="${row.order.id}"]`)?.scrollIntoView({ block: "nearest" });
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
            // In the Unassigned view the row leaves the list; keep the cursor moving.
            if (view === "unassigned") setCursor(visible[idx + 1]?.order.id ?? visible[idx - 1]?.order.id ?? null);
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
  }, [visible, cursor, view, me.id, navigate, assign]);

  const columns: Column<Row>[] = [
    {
      id: "select",
      header: "Select",
      width: "w-10",
      headerCell: (
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.order.id)))}
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
    { id: "flags", header: "Flags", width: "w-20", cell: (r) => <FlagIcons flags={r.flags} /> },
    {
      id: "scan",
      header: "Scan",
      cell: (r) =>
        r.order.scheduledAt ? <span className="tabular">{fmtTableDate(new Date(r.order.scheduledAt))}</span> : <span className="text-fg-3">—</span>,
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
        <Tip content={`${r.order.reason}${r.closed ? "" : ` · In status ${fmtDuration(r.minutesInStatus)}`}`}>
          <span>
            <StatusLabel tone={statusTone(r.order.status)}>{STATUSES[r.order.status].label}</StatusLabel>
          </span>
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

  return (
    <main className="mx-auto w-full max-w-wide p-6">
      <div className="mb-4">
        <PageTitle count={openCount}>Worklist</PageTitle>
      </div>

      <Tabs
        tabs={VIEWS.map((v) => ({ ...v, count: rows.filter((r) => inView(r, v.id, me)).length }))}
        value={view}
        onChange={changeView}
      />

      <div className="flex h-12 items-center gap-2">
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
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQuery(""))}
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
              onChange={setStatusFilter}
            />
            <FilterButton
              title="Insurer"
              value={insurerFilter}
              options={insurerOptions.map((i) => ({ id: i, label: i }))}
              onChange={setInsurerFilter}
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

      <div className="rounded-lg border border-line bg-panel">
        <DataTable
          columns={columns}
          rows={visible}
          getKey={(r) => r.order.id}
          selectedKey={cursor}
          onRowClick={(r) => navigate(`/case/${r.order.id}`)}
          empty="Nothing here"
        />
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, UserPlus, X } from "lucide-react";
import { AssignCell, eligiblePeople } from "@/components/AssignCell";
import { StatusLabel } from "@/components/badges";
import { FlagIcons, FlagLegend } from "@/components/flags";
import { PEOPLE } from "@/data/people";
import { STATUSES, type OwnerRole } from "@/domain/statuses";
import { TIME_RISK_LABEL, type TimeRisk } from "@/domain/timeRisk";
import type { Person } from "@/domain/types";
import { fmtDuration, fmtScan } from "@/lib/format";
import { usePersona } from "@/lib/persona";
import { useOrders } from "@/lib/useWorklistState";
import {
  bySchedule,
  inView,
  matchesQuick,
  matchesSearch,
  QUICK_FILTERS,
  toRow,
  VIEWS,
  type QuickFilter,
  type Row,
  type ViewId,
} from "@/lib/worklist";

const PERSONA_DEFAULT_VIEW: Record<Person["role"], ViewId> = {
  coordinator: "coordinator",
  nurse: "nurse",
  rules_admin: "nurse",
};

export default function Worklist() {
  const navigate = useNavigate();
  const { orders, assign, reset } = useOrders();
  const { me } = usePersona();

  const [view, setView] = useState<ViewId>("open");
  const [quick, setQuick] = useState<QuickFilter | null>(null);
  const [risk, setRisk] = useState<TimeRisk | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => orders.map((o) => toRow(o)), [orders]);

  const visible = useMemo(
    () =>
      rows
        .filter((r) => inView(r, view))
        .filter((r) => (quick ? matchesQuick(r, quick) : true))
        .filter((r) => (risk === "all" ? true : r.risk === risk))
        .filter((r) => (statusFilter === "all" ? true : r.order.status === statusFilter))
        .filter((r) => matchesSearch(r, query))
        .sort(bySchedule),
    [rows, view, quick, risk, statusFilter, query],
  );

  const statusOptions = useMemo(() => {
    const ids = new Set(rows.filter((r) => inView(r, view)).map((r) => r.order.status));
    return [...ids].map((id) => ({ id, label: STATUSES[id].label }));
  }, [rows, view]);

  const selectedRows = visible.filter((r) => selected.has(r.order.id));
  const selectedRoles = new Set<OwnerRole>(selectedRows.map((r) => r.ownerRole));
  const bulkEligible = (() => {
    const humanRoles = [...selectedRoles].filter((r) => r !== "system");
    if (selectedRows.length === 0 || humanRoles.length !== selectedRoles.size) return [];
    const lists = humanRoles.map((r) => new Set(eligiblePeople(r).map((p) => p.id)));
    return PEOPLE.filter((p) => lists.every((l) => l.has(p.id)));
  })();

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.order.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.order.id)));
  }

  // Switching persona (in the shell's top bar) lands on that role's default saved view.
  const prevPersonaId = useRef(me.id);
  useEffect(() => {
    if (prevPersonaId.current === me.id) return;
    prevPersonaId.current = me.id;
    setView(PERSONA_DEFAULT_VIEW[me.role]);
    setSelected(new Set());
    setStatusFilter("all");
    setQuick(null);
  }, [me.id, me.role]);

  function changeView(v: ViewId) {
    setView(v);
    setSelected(new Set());
    setStatusFilter("all");
  }

  const quickCount = (f: QuickFilter) => rows.filter((r) => matchesQuick(r, f)).length;
  const viewCount = (v: ViewId) => rows.filter((r) => inView(r, v)).length;

  return (
    <main className="mx-auto w-full max-w-[1500px] px-6 py-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Worklist</h1>
          <p className="text-sm text-slate-500">Sorted by scan date, earliest first.</p>
        </div>
        <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          Reset demo assignments
        </button>
      </div>

      {/* Quick filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => {
          const active = quick === f.id;
          const count = quickCount(f.id);
          return (
            <button
              key={f.id}
              onClick={() => setQuick(active ? null : f.id)}
              aria-pressed={active}
              className={`inline-flex items-baseline gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
                active
                  ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span
                className={`tabular font-semibold ${
                  f.id === "slot_at_risk" && count > 0 && !active ? "text-rose-600" : ""
                }`}
              >
                {count}
              </span>
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Saved views */}
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {VIEWS.map((v) => {
          const active = view === v.id;
          return (
            <button
              key={v.id}
              onClick={() => changeView(v.id)}
              title={v.hint}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {v.label}
              <span className="tabular ml-1.5 text-xs text-slate-400">{viewCount(v.id)}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patient, MRN, order #, insurer"
            className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={risk}
          onChange={(e) => setRisk(e.target.value as TimeRisk | "all")}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
          aria-label="Filter by time risk"
        >
          <option value="all">Any time risk</option>
          <option value="slot_at_risk">{TIME_RISK_LABEL.slot_at_risk}</option>
          <option value="at_risk">{TIME_RISK_LABEL.at_risk}</option>
          <option value="on_track">{TIME_RISK_LABEL.on_track}</option>
        </select>
        <FlagLegend />
        <span className="ml-auto text-xs text-slate-500">
          {visible.length} of {rows.length} orders
        </span>
      </div>

      {/* Bulk assign */}
      {selectedRows.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">
          <span className="font-medium">{selectedRows.length} selected</span>
          {bulkEligible.length > 0 ? (
            <>
              <UserPlus size={15} />
              <select
                aria-label="Assign selected to"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  assign(
                    selectedRows.map((r) => r.order.id),
                    e.target.value,
                  );
                  setSelected(new Set());
                }}
                className="rounded-md border-0 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                <option value="">Assign to…</option>
                {bulkEligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === me.id ? `${p.name} (me)` : p.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-indigo-100">
              Selection mixes system-owned or different-role orders. Pick rows with the same owner role to assign.
            </span>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-100 hover:text-white"
          >
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* Table: one fact per column */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1260px] text-left text-sm">
          <thead className="whitespace-nowrap border-b border-slate-200 text-xs font-medium text-slate-500">
            <tr>
              <th className="w-10 py-3 pl-4">
                <input type="checkbox" aria-label="Select all" checked={allVisibleSelected} onChange={toggleAll} />
              </th>
              <th className="w-[104px] px-3 py-3">Flags</th>
              <th className="px-3 py-3">Scan</th>
              <th className="px-3 py-3">Patient</th>
              <th className="px-3 py-3">MRN</th>
              <th className="px-3 py-3">Study</th>
              <th className="px-3 py-3">Side</th>
              <th className="px-3 py-3">Insurer</th>
              <th className="px-3 py-3">Status</th>
              <th className="w-[190px] px-3 py-3">Owner</th>
              <th className="py-3 pl-3 pr-4 text-right">In status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-slate-500">
                  No orders match these filters.
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <WorklistRow
                key={row.order.id}
                row={row}
                me={me}
                selected={selected.has(row.order.id)}
                onToggle={() => toggle(row.order.id)}
                onOpen={() => navigate(`/case/${row.order.id}`)}
                onAssign={(pid) => assign([row.order.id], pid)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Case 1 (Kirk) is the real test case. Other rows are seeded demo data from the PRD's expected-status table.
      </p>
    </main>
  );
}

function WorklistRow({
  row,
  me,
  selected,
  onToggle,
  onOpen,
  onAssign,
}: {
  row: Row;
  me: Person;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAssign: (personId: string | null) => void;
}) {
  const o = row.order;
  const scan = o.scheduledAt ? new Date(o.scheduledAt) : null;
  const muted = "text-slate-400";

  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer transition hover:bg-slate-50 ${selected ? "bg-indigo-50/60" : ""} ${
        row.closed ? "text-slate-500" : "text-slate-800"
      }`}
    >
      <td className="py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${o.patient?.name ?? "unmatched document"}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>

      <td className="px-3 py-2.5">
        <FlagIcons flags={row.flags} />
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">{scan ? fmtScan(scan) : <span className={muted}>—</span>}</td>

      <td className="whitespace-nowrap px-3 py-2.5 font-medium">
        {o.patient ? o.patient.name : <span className="font-normal italic text-slate-400">Unmatched</span>}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
        {o.patient ? o.patient.mrn : <span className={muted}>—</span>}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">{o.study}</td>

      <td className="whitespace-nowrap px-3 py-2.5">{o.side ?? <span className={muted}>—</span>}</td>

      <td className="whitespace-nowrap px-3 py-2.5">{o.insurer ?? <span className={muted}>—</span>}</td>

      <td className="px-3 py-2.5">
        <StatusLabel status={o.status} />
      </td>

      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <AssignCell role={row.ownerRole} assigneeId={o.assigneeId} me={me} closed={row.closed} onAssign={onAssign} />
      </td>

      <td className="tabular whitespace-nowrap py-2.5 pl-3 pr-4 text-right text-slate-500">
        {row.closed ? <span className={muted}>—</span> : fmtDuration(row.minutesInStatus)}
      </td>
    </tr>
  );
}

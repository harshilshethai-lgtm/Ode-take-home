import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Search, UserPlus, X, Zap } from "lucide-react";
import { AssignCell, eligiblePeople } from "@/components/AssignCell";
import { StatusBadge, TimeRiskBadge } from "@/components/badges";
import { CURRENT_USER_ID, PEOPLE, PEOPLE_BY_ID } from "@/data/people";
import { DEMO_NOW } from "@/data/orders";
import type { Person } from "@/domain/types";
import { STATUSES, type OwnerRole } from "@/domain/statuses";
import { TIME_RISK_LABEL, type TimeRisk } from "@/domain/timeRisk";
import { fmtCountdown, fmtDate, fmtDemoClock, fmtDob, fmtDuration, fmtTime } from "@/lib/format";
import { useOrders } from "@/lib/useWorklistState";
import {
  bySchedule,
  inView,
  matchesQuick,
  matchesSearch,
  needsAssignee,
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

  const [meId, setMeId] = useState(CURRENT_USER_ID);
  const me = PEOPLE_BY_ID[meId];

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

  function changePersona(id: string) {
    setMeId(id);
    const role = PEOPLE_BY_ID[id].role;
    setView(PERSONA_DEFAULT_VIEW[role]);
    setSelected(new Set());
    setStatusFilter("all");
    setQuick(null);
  }

  function changeView(v: ViewId) {
    setView(v);
    setSelected(new Set());
    setStatusFilter("all");
  }

  const quickCount = (f: QuickFilter) => rows.filter((r) => matchesQuick(r, f)).length;
  const viewCount = (v: ViewId) => rows.filter((r) => inView(r, v)).length;

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              H
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Halcyon Health</div>
              <div className="text-xs text-slate-500">Prior authorization</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
              title="Prototype clock. Fixed so scan dates and time-in-status in the sample data stay consistent."
            >
              <Clock size={13} /> Demo clock · {fmtDemoClock(DEMO_NOW)}
            </span>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Viewing as
              <select
                value={meId}
                onChange={(e) => changePersona(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                {PEOPLE.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-6 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">Worklist</h1>
            <p className="text-sm text-slate-500">
              One line per imaging order, sorted by scan date, earliest first.
            </p>
          </div>
          <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
            Reset demo assignments
          </button>
        </div>

        {/* Quick filters */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUICK_FILTERS.map((f) => {
            const active = quick === f.id;
            const count = quickCount(f.id);
            const danger = f.id === "slot_at_risk" && count > 0;
            return (
              <button
                key={f.id}
                onClick={() => setQuick(active ? null : f.id)}
                aria-pressed={active}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className={`text-2xl font-semibold tabular ${danger ? "text-rose-600" : "text-slate-900"}`}>
                  {count}
                </div>
                <div className="text-xs text-slate-500">{f.label}</div>
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
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                  active
                    ? "border-indigo-600 font-medium text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {v.label}
                <span className="tabular ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {viewCount(v.id)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient, MRN, order #, CPT, insurer"
              className="w-80 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
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
                      {p.id === me.id ? `Me (${p.name})` : p.name}
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

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1320px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 py-2.5 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="w-[150px] px-3 py-2.5">Scan</th>
                <th className="w-[150px] px-3 py-2.5">Patient</th>
                <th className="w-[190px] px-3 py-2.5">Order</th>
                <th className="w-[170px] px-3 py-2.5">Insurer</th>
                <th className="w-[300px] px-3 py-2.5">Status and reason</th>
                <th className="w-[190px] px-3 py-2.5">Owner</th>
                <th className="w-[90px] px-3 py-2.5">In status</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
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
          Case 1 (Kirk) is the real test case, with its source PDF, answer key and RAD-114 rule. Other rows are seeded
          demo data taken from the PRD's expected-status table.
        </p>
      </main>
    </div>
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
  const sla = STATUSES[o.status].slaHours;
  const unclaimed = needsAssignee(row);
  const isHuman = row.ownerRole !== "system";

  const riskBar =
    row.risk === "slot_at_risk"
      ? "border-l-rose-500"
      : row.risk === "at_risk"
        ? "border-l-amber-400"
        : "border-l-transparent";

  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-l-[3px] align-top transition hover:bg-slate-50 ${riskBar} ${
        selected ? "bg-indigo-50/60" : ""
      } ${row.closed ? "text-slate-500" : ""}`}
    >
      <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${o.patient?.name ?? "unmatched document"}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>

      {/* Scan + time risk */}
      <td className="px-3 py-3">
        {scan ? (
          <div className="space-y-0.5">
            <div className="whitespace-nowrap font-medium text-slate-900">
              {fmtDate(scan)} <span className="font-normal text-slate-600">{fmtTime(scan)}</span>
            </div>
            <div className="tabular text-xs text-slate-500">{fmtCountdown(scan, DEMO_NOW)}</div>
            <TimeRiskBadge risk={row.risk} />
          </div>
        ) : (
          <span className="text-xs text-slate-400">No scan date</span>
        )}
      </td>

      {/* Patient */}
      <td className="px-3 py-3">
        {o.patient ? (
          <div className="space-y-0.5">
            <div className="font-medium text-slate-900">{o.patient.name}</div>
            <div className="whitespace-nowrap text-xs text-slate-500">{o.patient.mrn}</div>
            <div className="whitespace-nowrap text-xs text-slate-500">DOB {fmtDob(o.patient.dob)}</div>
          </div>
        ) : (
          <span className="text-sm italic text-slate-500">Unmatched patient</span>
        )}
      </td>

      {/* Order */}
      <td className="px-3 py-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-slate-900">
            {o.study}
            {o.side && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                {o.side}
              </span>
            )}
            {o.priority === "Urgent" && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                URGENT
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {[o.orderNumber, o.cpt && `CPT ${o.cpt}`].filter(Boolean).join(" · ") || "No order yet"}
          </div>
        </div>
      </td>

      {/* Insurer */}
      <td className="px-3 py-3">
        {o.insurer ? (
          <div className="space-y-0.5">
            <div className="text-slate-900">{o.insurer}</div>
            {o.plan && <div className="text-xs text-slate-500">{o.plan}</div>}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {o.channel && (
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    o.channel === "api" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {o.channel === "api" && <Zap size={10} />}
                  {o.channel === "api" ? "API" : "Portal"}
                </span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Unknown</span>
        )}
      </td>

      {/* Status + reason */}
      <td className="px-3 py-3">
        <div className="space-y-1">
          <StatusBadge status={o.status} />
          <p className="text-xs leading-snug text-slate-600">{o.reason}</p>
        </div>
      </td>

      {/* Owner / assign */}
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <AssignCell
          role={row.ownerRole}
          assigneeId={o.assigneeId}
          me={me}
          closed={row.closed}
          onAssign={onAssign}
        />
      </td>

      {/* Time in status */}
      <td className="px-3 py-3">
        {row.closed ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span
            title={sla ? `SLA for this status: ${sla}h` : undefined}
            className={`tabular whitespace-nowrap text-xs ${row.overSla ? "font-semibold text-amber-600" : "text-slate-600"}`}
          >
            {fmtDuration(row.minutesInStatus)}
            {row.overSla && <span className="block text-[11px] font-medium">over SLA</span>}
          </span>
        )}
      </td>

      {/* Next action */}
      <td className="py-3 pl-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
        {isHuman && !row.closed ? (
          <button
            onClick={onOpen}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium ${
              unclaimed
                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            {o.nextAction} <ArrowRight size={12} />
          </button>
        ) : (
          <span className="text-xs text-slate-500">{o.nextAction}</span>
        )}
      </td>
    </tr>
  );
}

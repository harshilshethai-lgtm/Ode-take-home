import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Filter, Search, X } from "lucide-react";
import { AssignMenu, eligiblePeople, firstName } from "@/components/AssignMenu";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { CitationChip } from "@/components/ui/citation-chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FlagIcons } from "@/components/ui/flag-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Kbd } from "@/components/ui/kbd";
import { PageTitle } from "@/components/ui/page-title";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PropertyList } from "@/components/ui/property-list";
import { SourceTag } from "@/components/ui/source-tag";
import { StatusDot } from "@/components/ui/status-dot";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { PEOPLE } from "@/data/people";
import { buildCaseRecord } from "@/domain/caseRecord";
import { actionStatusLabel } from "@/domain/priorAuth/render";
import { memberIdFor } from "@/domain/memberId";
import { normalizeProvider } from "@/domain/providers";
import { STATUSES } from "@/domain/statuses";
import { cn } from "@/lib/cn";
import type { Order, Person } from "@/domain/types";
import { DEMO_NOW, SUBMIT_BY_HINT, parseDemoInstant, relativeToClock } from "@/lib/demoClock";
import { fmtDob, fmtTableDate } from "@/lib/format";
import { CHANNEL_LABEL, SIDE_SHORT, label } from "@/lib/labels";
import { eligibilityFor } from "@/lib/mocks/eligibility";
import { usePersona } from "@/lib/persona";
import { useOrders } from "@/lib/useWorklistState";
import { byRiskThenScan, bySchedule, inView, isSlotAtRisk, matchesPolicy, matchesSearch, scanAttention, toRow, VIEWS, type Row, type ViewId } from "@/lib/worklist";
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
  const slotAtRisk = url.slotAtRisk;
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
      .filter((r) => (slotAtRisk ? isSlotAtRisk(r) : true))
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
          return dir === "asc" ? byRiskThenScan(a, b) : bySchedule(b, a);
        case "provider":
          return cmpText(facts.get(a.order.id)?.provider, facts.get(b.order.id)?.provider, dir);
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
  }, [rows, view, statusFilter, reasonFilter, hideWaiting, slotAtRisk, insurerFilter, policyFilter, query, sort, facts, viewer]);

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

  const showStatus = view === "all";
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
      className={cn("absolute -left-6 accent-accent", selected.size === 0 && "opacity-0 group-hover/table:opacity-100 focus-visible:opacity-100")}
    />
  );

  const columns: Column<Row>[] = [
    {
      id: "flags",
      header: "Flags",
      width: "9%",
      headerCell: (
        <span className="relative inline-flex items-center">
          {selectPage}
          Flags
        </span>
      ),
      cell: (r) => (
        <span className="relative inline-flex items-center">
          <input
            type="checkbox"
            aria-label={`Select ${r.order.patient?.name ?? "unmatched document"}`}
            checked={selected.has(r.order.id)}
            onChange={() => toggle(r.order.id)}
            onClick={(e) => e.stopPropagation()}
            className="absolute -left-6 accent-accent opacity-0 checked:opacity-100 group-hover:opacity-100"
          />
          <FlagIcons flags={r.flags} />
        </span>
      ),
    },
    {
      id: "scan",
      header: "Scan",
      width: "16%",
      headerCell: (
        <Tip content={SUBMIT_BY_HINT}>
          <span>{sortHeader("appointment", "Scan")}</span>
        </Tip>
      ),
      cell: (r) => <ScanCell row={r} />,
    },
    {
      id: "patient",
      header: "Patient",
      width: "16%",
      wrap: true,
      headerCell: sortHeader("patient", "Patient"),
      cell: (r) => <PatientCell row={r} facts={facts.get(r.order.id)} />,
    },
    {
      id: "study",
      header: "Study",
      width: "12%",
      headerCell: sortHeader("study", "Study"),
      cell: (r) => {
        const text = r.order.side ? `${r.order.study} · ${label(SIDE_SHORT, r.order.side)}` : r.order.study;
        if (!text) return null;
        return (
          <Tip content={`${text}. ${EPIC_CHECKED}`}>
            <span className="block truncate">{text}</span>
          </Tip>
        );
      },
    },
    {
      id: "insurer",
      header: "Insurer",
      width: "15%",
      headerCell: sortHeader("insurance", "Insurer"),
      cell: (r) => {
        if (!r.order.insurer) return null;
        const member = facts.get(r.order.id)?.memberId;
        const full = [r.order.insurer, r.order.plan, member].filter(Boolean).join(" · ");
        return (
          <Tip content={`${full}. ${EPIC_CHECKED}`}>
            <span className="block min-w-0">
              <span className="block truncate">{r.order.insurer}</span>
              {member && <span className="block truncate font-mono text-caption text-fg-2">{member}</span>}
            </span>
          </Tip>
        );
      },
    },
    showStatus
      ? {
          id: "status",
          header: "Status",
          width: "14%",
          headerCell: sortHeader("status", "Status"),
          cell: (r) => (
            <Tip content={r.order.reason}>
              <span className="block truncate">
                <StatusPill status={r.order.status} channel={r.order.channel} reasonCode={r.order.reasonCode} />
              </span>
            </Tip>
          ),
        }
      : {
          id: "reason",
          header: "Reason",
          width: "14%",
          headerCell: sortHeader("reason", "Reason"),
          cell: (r) => <ReasonCell row={r} />,
        },
    {
      id: "owner",
      header: "Owner",
      width: "10%",
      headerCell: sortHeader("assignee", "Owner"),
      cell: (r) => {
        const canAssign = eligiblePeople(r.ownerRole).some((person) => person.id === me.id);
        const menu = (
          <span className="inline-flex max-w-full" onClick={(e) => e.stopPropagation()}>
            <AssignMenu role={r.ownerRole} assigneeId={r.order.assigneeId} me={me} closed={r.closed} onAssign={(pid) => assign([r.order.id], pid)} />
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
    },
    {
      id: "age",
      header: "Age",
      width: "8%",
      align: "right",
      headerCell: sortHeader("received", "Age"),
      cell: (r) => (
        <Tip content={parseDemoInstant(r.order.statusSince).toISOString()}>
          <span className="tabular text-fg-2">{relativeToClock(r.order.statusSince)}</span>
        </Tip>
      ),
    },
  ];


  const openCount = rows.filter((r) => !r.closed).length;
  const from = visible.length === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(visible.length, (safePage + 1) * pageSize);

  return (
    <main aria-keyshortcuts="j k Enter a" className="flex h-full min-h-0 flex-col bg-panel">
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
            {slotAtRisk ? (
              <RemovableChip onRemove={() => commit({ slotAtRisk: false, page: 0 })}>Slot at risk</RemovableChip>
            ) : (
              <Button variant="ghost" aria-pressed={false} onClick={() => commit({ slotAtRisk: true, page: 0 })}>
                Slot at risk
              </Button>
            )}
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

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
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
                      className="table-fixed"
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
            className="table-fixed"
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
  providerPage: number | null;
  providerQuote: string | null;
  memberId: string | null;
  dobPage: number | null;
  dobQuote: string | null;
}

function factsFor(order: Order): PatientFacts {
  const record = buildCaseRecord(order);
  const provider = record.elements.find((element) => element.label === "Ordering provider");
  const dob = record.elements.find((element) => element.label === "DOB and MRN");
  return {
    provider: provider?.value ? normalizeProvider(provider.value.split(" · ")[0] ?? provider.value).list : null,
    providerPage: provider?.cite?.page ?? null,
    providerQuote: provider?.cite?.quote ?? null,
    memberId: memberIdFor(order)?.value ?? eligibilityFor(order.patient?.mrn)?.memberId ?? null,
    dobPage: dob?.cite?.page ?? null,
    dobQuote: dob?.cite?.quote ?? null,
  };
}

function Sourced({ text, page, quote, mono }: { text: string | null; page?: number | null; quote?: string | null; mono?: boolean }) {
  if (!text) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className={cn("truncate", mono && "font-mono")}>{text}</span>
      {page ? <CitationChip page={page} excerpt={quote ?? undefined} /> : <SourceTag lastRun={fmtTableDate(DEMO_NOW)} />}
    </span>
  );
}

function ScanCell({ row }: { row: Row }) {
  if (!row.order.scheduledAt) return <span className="text-fg-2">No slot</span>;
  const when = fmtTableDate(parseDemoInstant(row.order.scheduledAt));
  const atRisk = scanAttention(row) === "At risk";
  const note = [atRisk ? "At risk" : "", row.order.scheduleHandwritten ? "Handwritten" : "", SUBMIT_BY_HINT].filter(Boolean).join(". ");
  return (
    <Tip content={`${when}. ${note}`}>
      <span className="inline-flex max-w-full items-center gap-2">
        {atRisk ? (
          <span aria-label="At risk" className="inline-flex">
            <StatusDot tone="blocked" />
          </span>
        ) : (
          <span className="inline-block size-dot shrink-0" aria-hidden />
        )}
        <span className="min-w-0">
          <span className="tabular block truncate">{when}</span>
          {(atRisk || row.order.scheduleHandwritten || row.order.priority === "Urgent") && (
            <span className={cn("block truncate text-caption", atRisk || row.order.priority === "Urgent" ? "text-bad" : "text-fg-3")}>
              {[row.order.priority === "Urgent" ? "Urgent" : "", atRisk ? "At risk" : "", row.order.scheduleHandwritten ? "Handwritten" : ""].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </span>
    </Tip>
  );
}

function PatientCell({ row, facts }: { row: Row; facts: PatientFacts | undefined }) {
  const patient = row.order.patient;
  if (!patient) return <span className="text-fg-2">Unmatched</span>;
  const dob = fmtDob(patient.dob);
  const type = row.order.channel ? label(CHANNEL_LABEL, row.order.channel) : null;
  return (
    <span className="block min-w-0 leading-4">
      <HoverCard openDelay={300} closeDelay={80}>
        <HoverCardTrigger asChild>
          <Link to={`/case/${row.order.id}`} className="block truncate font-medium text-fg" onClick={(e) => e.stopPropagation()}>
            {patient.name}
          </Link>
        </HoverCardTrigger>
        <HoverCardContent onClick={(e) => e.stopPropagation()}>
          <PropertyList
            items={[
              { label: "DOB", value: <Sourced text={dob} page={facts?.dobPage} quote={facts?.dobQuote} mono /> },
              { label: "MRN", value: <Sourced text={patient.mrn} page={facts?.dobPage} quote={facts?.dobQuote} mono /> },
              { label: "Member ID", value: <Sourced text={facts?.memberId ?? null} mono /> },
              { label: "Ordering provider", value: <Sourced text={facts?.provider ?? null} page={facts?.providerPage} quote={facts?.providerQuote} /> },
              { label: "Type", value: <Sourced text={type} /> },
              { label: "Reason", value: row.order.reason || null },
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
      <span className="block truncate font-mono text-caption text-fg-2">
        {dob} · {patient.mrn}
      </span>
    </span>
  );
}

function ReasonCell({ row }: { row: Row }) {
  const waiting = row.waiting && row.order.waitingOn ? `Waiting on ${row.order.waitingOn}` : "";
  const tip = [row.order.reason, waiting].filter(Boolean).join(". ");
  if (row.stepText) {
    return (
      <Tip content={tip}>
        <span className="block truncate text-fg-2">{row.stepText}</span>
      </Tip>
    );
  }
  if (actionStatusLabel(row.order.reasonCode) && row.order.reason) {
    return (
      <Tip content={tip}>
        <span className="block truncate">{row.order.reason}</span>
      </Tip>
    );
  }
  if (!row.reasonChip) return null;
  if (row.closed) {
    return (
      <Tip content={tip}>
        <span className="block truncate text-fg-2">{row.reasonChip}</span>
      </Tip>
    );
  }
  return (
    <Tip content={tip}>
      <span className="inline-flex max-w-full">
        <Chip>{row.reasonChip}</Chip>
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

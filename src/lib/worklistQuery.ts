import type { ViewId } from "@/lib/worklist";

export const VIEW_IDS: ViewId[] = ["needs_me", "at_risk", "admin", "clinical", "return_to_provider", "in_flight", "with_insurer", "closed", "all"];

const LEGACY_VIEW: Record<string, ViewId> = {};

export type SortKey = "patient" | "status" | "reason" | "insurance" | "study" | "due" | "appointment" | "provider" | "type" | "urgency" | "received" | "assignee";
export type SortDir = "asc" | "desc";

export interface WorklistUrlState {
  view: ViewId;
  status: string | null;
  reason: string | null;
  insurer: string | null;
  /** Insurer policy id. Shows every open case checked against it, across queues. */
  policy: string | null;
  hideWaiting: boolean;
  q: string;
  sort: SortKey;
  dir: SortDir;
  /** Zero-based page index. */
  page: number;
}

const SORT_KEYS = new Set<SortKey>([
  "patient",
  "status",
  "reason",
  "insurance",
  "study",
  "due",
  "appointment",
  "provider",
  "type",
  "urgency",
  "received",
  "assignee",
]);

const DEFAULT_SORT: SortKey = "due";
const DEFAULT_DIR: SortDir = "asc";

function isView(value: string | null): value is ViewId {
  return VIEW_IDS.includes(value as ViewId);
}

function viewFrom(tab: string | null, fallback: ViewId): ViewId {
  if (!tab) return fallback;
  if (tab in LEGACY_VIEW) return LEGACY_VIEW[tab];
  return isView(tab) ? tab : fallback;
}

function isSort(value: string): value is SortKey {
  return SORT_KEYS.has(value as SortKey);
}

/** Older links sorted by the scan column. That column is now Due. */
function sortKeyFrom(value: string): SortKey {
  if (value === "appointment") return "due";
  return isSort(value) ? value : DEFAULT_SORT;
}

/** Read the worklist from the query string. A missing tab uses the persona's queue. */
export function parseWorklistUrl(params: URLSearchParams, fallbackView: ViewId): WorklistUrlState {
  const tab = params.get("tab") ?? (params.get("risk") === "slot" ? "at_risk" : null);
  const rawSort = params.get("sort") ?? "";
  const desc = rawSort.startsWith("-");
  const key = desc ? rawSort.slice(1) : rawSort;
  const pageRaw = Number(params.get("page") ?? "1");
  return {
    view: viewFrom(tab, fallbackView),
    status: params.get("status"),
    reason: params.get("reason"),
    insurer: params.get("insurer"),
    policy: params.get("policy"),
    hideWaiting: params.get("waiting") === "hidden",
    q: params.get("q") ?? "",
    sort: sortKeyFrom(key),
    dir: rawSort === "" ? DEFAULT_DIR : desc ? "desc" : "asc",
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw - 1 : 0,
  };
}

/** Omit values that match the defaults so a fresh queue stays at `/`. */
export function serializeWorklistUrl(state: WorklistUrlState, fallbackView: ViewId): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== fallbackView) params.set("tab", state.view);
  if (state.status) params.set("status", state.status);
  if (state.reason) params.set("reason", state.reason);
  if (state.insurer) params.set("insurer", state.insurer);
  if (state.policy) params.set("policy", state.policy);
  if (state.hideWaiting) params.set("waiting", "hidden");
  if (state.q) params.set("q", state.q);
  if (state.sort !== DEFAULT_SORT || state.dir !== DEFAULT_DIR) {
    params.set("sort", state.dir === "desc" ? `-${state.sort}` : state.sort);
  }
  if (state.page > 0) params.set("page", String(state.page + 1));
  return params;
}

// Evaluates a criterion's properties against facts. Each property with a check is verified; a property without
// one is "Not auto-checked" and sends the criterion to a person.
//
// Checks on the same fact group work together. Filters (within_months, source_in, source_not_in, same_side)
// narrow which facts count; measures (min_weeks, present, absent) decide on what is left. A group with filters
// but no measure is read as "present".
//
// Criterion status: not_met if any check fails, else unknown if evidence is missing, else needs_review if any
// property has no check (or a side could not be matched), else met.

import { SOURCE_LABEL, asRecord, factRef, joinList, plural, sourceBlurb, uniq } from "./common";
import { addMonths, daysBetween, weeksBetween } from "./dates";
import { getFactKind, type FactKind } from "./facts";
import type { CheckOp, EvaluationContext, Fact, FactRef, Laterality, Property, PropertyResult } from "./types";

type Status = PropertyResult["status"];

export const FILTER_OPS: ReadonlySet<CheckOp> = new Set(["within_months", "source_in", "source_not_in", "same_side"]);
const RANK: Record<Status, number> = { met: 0, needs_review: 1, unknown: 2, not_met: 3 };
export const worst = (xs: Status[]): Status => xs.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), "met");

export const NOT_AUTO_CHECKED = "Not auto-checked; a person reviews this.";

export interface CriterionCheckResult {
  status: Status;
  detail: string;
  evidenceRefs: FactRef[];
  propertyResults: PropertyResult[];
}

/* ------------------------------- fact helpers ------------------------------- */

interface Interval {
  start: string;
  end: string;
}

/** Treatment facts carry value.startDate / value.endDate; `date` is the last day. */
function intervalOf(f: Fact): Interval {
  const v = asRecord(f.value);
  const end = typeof v.endDate === "string" ? v.endDate : f.date;
  const start = typeof v.startDate === "string" ? v.startDate : end;
  return { start, end };
}

function coveredDays(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
  let total = 0;
  let cur: Interval | null = null;
  for (const iv of sorted) {
    if (cur && iv.start <= cur.end) {
      if (iv.end > cur.end) cur = { start: cur.start, end: iv.end };
    } else {
      if (cur) total += daysBetween(cur.start, cur.end);
      cur = { ...iv };
    }
  }
  if (cur) total += daysBetween(cur.start, cur.end);
  return total;
}

type SideMatch = "match" | "mismatch" | "unknown";
/** If either side is not documented we cannot say, and must not guess. */
function sideMatch(factSide: Laterality | undefined, orderSide: Laterality | undefined): SideMatch {
  if (!factSide || !orderSide) return "unknown";
  if (factSide === "bilateral" || orderSide === "bilateral") return "match";
  return factSide === orderSide ? "match" : "mismatch";
}

const modalityOf = (f: Fact) => {
  const m = asRecord(f.value).modality;
  return typeof m === "string" ? m.replace(/_/g, " ") : "treatment";
};
const latest = (fs: Fact[]) => [...fs].sort((a, b) => b.date.localeCompare(a.date))[0];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/* ------------------------------- filters ------------------------------- */

interface Item {
  prop: Property;
  index: number;
  kind: FactKind;
}

interface Narrowed {
  raw: Fact[];
  kept: Fact[];
  /** Facts a same-side filter could not place because a side is missing. */
  uncertain: Fact[];
  /** The filter that removed the last remaining facts, with what it removed. */
  emptiedBy: { item: Item; dropped: Fact[] } | null;
  /** Some facts were ignored for their source but others remain. */
  ignoredSources: boolean;
  windowStart: string | null;
  windowMonths: number | null;
}

function narrow(raw: Fact[], filters: Item[], ctx: EvaluationContext): Narrowed {
  let kept = raw;
  let uncertain: Fact[] = [];
  let emptiedBy: Narrowed["emptiedBy"] = null;
  let ignoredSources = false;
  let windowStart: string | null = null;
  let windowMonths: number | null = null;
  for (const item of filters) {
    const { op } = item.prop.check!;
    const before = kept;
    if (op === "within_months") {
      const months = num(item.prop.value);
      if (!months) continue;
      windowMonths = months;
      windowStart = addMonths(ctx.serviceDate, -months);
      kept = kept.filter((f) => intervalOf(f).end >= windowStart!);
    } else if (op === "source_in" || op === "source_not_in") {
      const list = strings(item.prop.value);
      kept = kept.filter((f) => (op === "source_in" ? list.includes(f.sourceType) : !list.includes(f.sourceType)));
      if (kept.length > 0 && kept.length < before.length) ignoredSources = true;
    } else if (op === "same_side") {
      if (item.prop.value !== true) continue;
      const next: Fact[] = [];
      for (const f of kept) {
        const m = sideMatch(f.laterality, ctx.laterality);
        if (m === "match") next.push(f);
        else if (m === "unknown") uncertain.push(f);
      }
      kept = next;
    }
    if (before.length > 0 && kept.length === 0 && !emptiedBy) emptiedBy = { item, dropped: before };
  }
  if (kept.length > 0) uncertain = [];
  return { raw, kept, uncertain, emptiedBy, ignoredSources, windowStart, windowMonths };
}

/** Why the filter left nothing, as a sentence. */
function dropReason(n: Narrowed, noun: string, ctx: EvaluationContext): { status: Status; detail: string } {
  const { item, dropped } = n.emptiedBy!;
  const { op } = item.prop.check!;
  if (op === "within_months") {
    const last = latest(dropped);
    return { status: "not_met", detail: `Found ${noun} dated ${last.date} (${sourceBlurb(last)}), but none within the past ${plural(num(item.prop.value) ?? 0, "month")}.` };
  }
  if (op === "same_side") {
    if (n.uncertain.length > 0) {
      return {
        status: "unknown",
        detail: `Found ${noun} (${n.uncertain.map(sourceBlurb).join("; ")}), but the side is not documented, so it cannot be matched to the ${ctx.laterality ?? "ordered"} side.`,
      };
    }
    return { status: "not_met", detail: `Found ${noun} (${dropped.map(sourceBlurb).join("; ")}), but only of the opposite side.` };
  }
  const labels = uniq(dropped.map((f) => SOURCE_LABEL[f.sourceType]));
  const article = labels.length === 1 && /^[aeiou]/.test(labels[0]) ? "an" : "a";
  const kind = labels.length === 1 ? `${article} ${labels[0]} source` : `these sources (${joinList(labels, "and")})`;
  return { status: "not_met", detail: `Found ${noun} only in ${kind}, which this policy does not accept.` };
}

/* ------------------------------- measures ------------------------------- */

interface Measured {
  status: Status;
  detail: string;
  refs: FactRef[];
}

function measure(m: { op: CheckOp; value: unknown; kind: FactKind }, n: Narrowed, ctx: EvaluationContext, facts: Fact[]): Measured {
  const noun = m.kind.noun(ctx);
  const ignored = n.ignoredSources ? " Records from sources this policy does not accept were ignored." : "";
  const window = n.windowMonths ? ` within the past ${plural(n.windowMonths, "month")}` : "";

  if (m.op === "absent") {
    if (n.kept.length > 0) {
      const last = latest(n.kept);
      return { status: "not_met", detail: `Found ${noun} dated ${last.date} (${sourceBlurb(last)})${window}; policy allows none.`, refs: [factRef(last)] };
    }
    if (n.uncertain.length > 0) {
      return {
        status: "needs_review",
        detail: `Found ${noun}${window} (${n.uncertain.map(sourceBlurb).join("; ")}), but the side is not documented, so it cannot be ruled out as the same side.`,
        refs: n.uncertain.map(factRef),
      };
    }
    const proof = m.kind.proof ? latest(facts.filter((f) => f.type === m.kind.proof)) : undefined;
    if (!m.kind.proof) return { status: "met", detail: `No ${noun} found${window}.`, refs: [] };
    if (proof) return { status: "met", detail: `Imaging history reviewed (${sourceBlurb(proof)}); no ${noun} found${window}.`, refs: [factRef(proof)] };
    return { status: "unknown", detail: `No documentation found for imaging history, so a prior ${noun} cannot be ruled out.`, refs: [] };
  }

  if (n.raw.length === 0) return { status: "unknown", detail: `No documentation found for ${noun}.`, refs: [] };
  if (n.kept.length === 0) {
    const why = dropReason(n, noun, ctx);
    return { status: why.status, detail: why.detail, refs: (n.uncertain.length ? n.uncertain : n.emptiedBy!.dropped).map(factRef) };
  }

  if (m.op === "present") {
    const last = latest(n.kept);
    return { status: "met", detail: `Found ${noun} dated ${last.date} (${sourceBlurb(last)})${window}.${ignored}`, refs: [factRef(last)] };
  }

  // min_weeks
  const need = num(m.value);
  if (!need) return { status: "needs_review", detail: "This check has no number of weeks to compare against.", refs: [] };
  if (m.kind.duration === "since") {
    const earliest = [...n.kept].sort((a, b) => a.date.localeCompare(b.date))[0];
    const weeks = weeksBetween(earliest.date, ctx.serviceDate);
    const detail = `Found ${noun} dated ${earliest.date} (${plural(weeks, "week")} before the service date, ${sourceBlurb(earliest)}); policy requires at least ${plural(need, "week")}.${ignored}`;
    return { status: weeks >= need ? "met" : "not_met", detail, refs: [factRef(earliest)] };
  }
  if (m.kind.duration === "covered") {
    const clipped = n.kept.map((f) => {
      const iv = intervalOf(f);
      return { start: n.windowStart && iv.start < n.windowStart ? n.windowStart : iv.start, end: iv.end };
    });
    const weeks = Math.floor(coveredDays(clipped) / 7);
    const what = joinList(uniq(n.kept.map(modalityOf)), "and");
    const sources = uniq(n.kept.map(sourceBlurb)).join("; ");
    const detail = `Found ${plural(weeks, "week")} of ${what} (${sources}); policy requires at least ${plural(need, "week")}${window}.${ignored}`;
    return { status: weeks >= need ? "met" : "not_met", detail, refs: n.kept.map(factRef) };
  }
  return { status: "needs_review", detail: `Weeks cannot be measured for ${noun}; a person reviews this.`, refs: [] };
}

/* ------------------------------- criterion ------------------------------- */

export function evaluateProperties(properties: Property[], facts: Fact[], ctx: EvaluationContext): CriterionCheckResult {
  if (properties.length === 0) {
    return { status: "needs_review", detail: "Nothing on this criterion is checked automatically; a person reviews it.", evidenceRefs: [], propertyResults: [] };
  }
  const results: PropertyResult[] = properties.map((p) => ({ key: p.key, label: p.label, status: "needs_review", detail: NOT_AUTO_CHECKED }));
  const set = (i: number, status: Status, detail: string) => (results[i] = { ...results[i], status, detail });
  const groups = new Map<string, { filters: Item[]; measures: Item[] }>();
  properties.forEach((prop, index) => {
    if (!prop.check) return;
    const kind = getFactKind(prop.check.fact);
    if (!kind) return set(index, "needs_review", `Unknown fact "${prop.check.fact}"; a person reviews this.`);
    const g = groups.get(kind.group) ?? { filters: [], measures: [] };
    (FILTER_OPS.has(prop.check.op) ? g.filters : g.measures).push({ prop, index, kind });
    groups.set(kind.group, g);
  });

  const refs: FactRef[] = [];
  const measureDetails: string[] = [];
  for (const { filters, measures } of groups.values()) {
    const ms = measures.length ? measures.map((m) => ({ ...m, op: m.prop.check!.op, value: m.prop.value })) : [{ ...filters[0], op: "present" as CheckOp, value: true, index: -1 }];
    const filterStatus = new Map<number, Status[]>();
    for (const m of ms) {
      const n = narrow(
        facts.filter((f) => m.kind.match(f, ctx)),
        filters,
        ctx,
      );
      const r = measure(m, n, ctx, facts);
      refs.push(...r.refs);
      if (m.index >= 0) set(m.index, r.status, r.detail);
      measureDetails.push(r.detail);
      for (const f of filters) {
        const emptied = n.emptiedBy?.item.index === f.index && m.op !== "absent";
        const s: Status = emptied ? r.status : m.op === "absent" || r.status !== "not_met" ? r.status : "met";
        filterStatus.set(f.index, [...(filterStatus.get(f.index) ?? []), s]);
        if (emptied || m.index < 0) set(f.index, s, r.detail);
      }
    }
    for (const f of filters) {
      const s = worst(filterStatus.get(f.index) ?? ["met"]);
      if (results[f.index].detail === NOT_AUTO_CHECKED) set(f.index, s, s === "met" ? "Applied." : "See the related check.");
      else results[f.index] = { ...results[f.index], status: s };
    }
  }

  const status = worst(results.map((r) => r.status));
  const firstWith = results.find((r) => r.status === status && status !== "met");
  const detail = firstWith ? firstWith.detail : uniq(measureDetails).join(" ");
  const seen = new Set<string>();
  const evidenceRefs = refs.filter((r) => (seen.has(r.factId) ? false : (seen.add(r.factId), true)));
  return { status, detail, evidenceRefs, propertyResults: results };
}

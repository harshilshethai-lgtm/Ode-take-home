// Plain-English diff between two versions. Criteria and exceptions are matched by stable `key`, never by id.

import { describeCriterion, describeException, describeValue } from "./describe";
import type { Criterion, PolicyException, PolicyVersion, Property } from "./types";

export interface Seg {
  text: string;
  kind: "same" | "del" | "add";
}

export interface ValueChange {
  label: string;
  from: string;
  to: string;
  emphasis?: "waiver_scope";
}

export interface CriterionSide {
  displayLabel: string;
  text: string;
  ref: string;
  excerpt: string;
  isAssumption: boolean;
  evaluationMode: string;
}

export interface CriterionDiff {
  key: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  label: string;
  before?: CriterionSide;
  after?: CriterionSide;
  /** Sentence diff: deleted words in `before`, inserted words in `after`. */
  segments?: { before: Seg[]; after: Seg[] };
  changes: ValueChange[];
  citationChanges: ValueChange[];
}

export interface ExceptionDiff {
  key: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  label: string;
  beforeText?: string;
  afterText?: string;
  changes: ValueChange[];
  citationChanges: ValueChange[];
}

export interface VersionDiff {
  a: { id: string; versionNumber: number };
  b: { id: string; versionNumber: number };
  criteria: CriterionDiff[];
  exceptions: ExceptionDiff[];
  applicability: ValueChange[];
  /** Policy-level properties: plan types, channels, attachments, incomplete requests, and any others. */
  properties: ValueChange[];
  source: ValueChange[];
  /** True when nothing differs at all. */
  identical: boolean;
}

/* ---------- word-level diff ---------- */

function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(before: string, after: string): { before: Seg[]; after: Seg[] } {
  const a = tokenize(before);
  const b = tokenize(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const outA: Seg[] = [];
  const outB: Seg[] = [];
  const push = (arr: Seg[], text: string, kind: Seg["kind"]) => {
    const last = arr[arr.length - 1];
    if (last && last.kind === kind) last.text += text;
    else arr.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(outA, a[i], "same");
      push(outB, b[j], "same");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push(outA, a[i++], "del");
    else push(outB, b[j++], "add");
  }
  while (i < a.length) push(outA, a[i++], "del");
  while (j < b.length) push(outB, b[j++], "add");
  return { before: outA, after: outB };
}

/* ---------- value formatting ---------- */

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return "(not set)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x).replace(/_/g, " ")).join(", ") : "(none)";
  return String(v);
}
const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

function listChange(label: string, from: string[], to: string[]): ValueChange | null {
  if (same(from, to)) return null;
  return { label, from: from.join(", ") || "(none)", to: to.join(", ") || "(none)" };
}

function compact<T>(xs: Array<T | null>): T[] {
  return xs.filter((x): x is T => x !== null);
}

/* ---------- criteria ---------- */

function side(c: Criterion): CriterionSide {
  return {
    displayLabel: c.displayLabel,
    text: describeCriterion(c),
    ref: c.ref,
    excerpt: c.excerpt,
    isAssumption: c.properties.some((p) => !!p.assumption),
    evaluationMode: c.evaluationMode,
  };
}

const checkText = (p: Property) => (p.check ? `${p.check.op.replace(/_/g, " ")} (${p.check.fact.replace(/_/g, " ")})` : "not auto-checked");

/** One change per property that differs, matched by key. */
export function propertyChanges(a: Property[], b: Property[]): ValueChange[] {
  const aBy = new Map(a.map((p) => [p.key, p]));
  const bKeys = new Set(b.map((p) => p.key));
  const out: ValueChange[] = [];
  for (const pb of b) {
    const pa = aBy.get(pb.key);
    if (!pa) {
      out.push({ label: pb.label, from: "(not set)", to: describeValue(pb) });
      continue;
    }
    const va = describeValue(pa);
    const vb = describeValue(pb);
    if (va !== vb) out.push({ label: pb.label, from: va, to: vb });
    if (pa.label !== pb.label) out.push({ label: "Property name", from: pa.label, to: pb.label });
    if (!same(pa.check, pb.check)) out.push({ label: `${pb.label} check`, from: checkText(pa), to: checkText(pb) });
    if ((pa.assumption ?? "") !== (pb.assumption ?? "")) out.push({ label: `${pb.label} assumption`, from: fmt(pa.assumption), to: fmt(pb.assumption) });
  }
  for (const pa of a) if (!bKeys.has(pa.key)) out.push({ label: pa.label, from: describeValue(pa), to: "(removed)" });
  return out;
}

function citationChanges(a: { ref: string; excerpt: string }, b: { ref: string; excerpt: string }): ValueChange[] {
  const out: ValueChange[] = [];
  if (a.ref !== b.ref) out.push({ label: "Reference", from: a.ref, to: b.ref });
  if (a.excerpt !== b.excerpt) out.push({ label: "Source text", from: a.excerpt, to: b.excerpt });
  return out;
}

function diffCriteria(a: PolicyVersion, b: PolicyVersion): CriterionDiff[] {
  const aBy = new Map(a.criteria.map((c) => [c.key, c]));
  const bBy = new Map(b.criteria.map((c) => [c.key, c]));
  const out: CriterionDiff[] = [];
  const bOrdered = [...b.criteria].sort((x, y) => x.sortOrder - y.sortOrder);
  for (const cb of bOrdered) {
    const ca = aBy.get(cb.key);
    if (!ca) {
      out.push({ key: cb.key, kind: "added", label: cb.displayLabel, after: side(cb), changes: [], citationChanges: [] });
      continue;
    }
    const sa = side(ca);
    const sb = side(cb);
    const changes = [
      ...propertyChanges(ca.properties, cb.properties),
      ...compact([
        ca.displayLabel !== cb.displayLabel ? { label: "Label", from: ca.displayLabel, to: cb.displayLabel } : null,
        ca.evaluationMode !== cb.evaluationMode ? { label: "Evaluation mode", from: fmt(ca.evaluationMode), to: fmt(cb.evaluationMode) } : null,
        ca.failureType !== cb.failureType ? { label: "Failure type", from: fmt(ca.failureType), to: fmt(cb.failureType) } : null,
      ]),
    ];
    const cites = citationChanges(ca, cb);
    const changed = changes.length > 0 || cites.length > 0;
    out.push({
      key: cb.key,
      kind: changed ? "changed" : "unchanged",
      label: cb.displayLabel,
      before: sa,
      after: sb,
      segments: sa.text !== sb.text ? diffWords(sa.text, sb.text) : undefined,
      changes,
      citationChanges: cites,
    });
  }
  for (const ca of [...a.criteria].sort((x, y) => x.sortOrder - y.sortOrder)) {
    if (!bBy.has(ca.key)) out.push({ key: ca.key, kind: "removed", label: ca.displayLabel, before: side(ca), changes: [], citationChanges: [] });
  }
  return out;
}

/* ---------- exceptions ---------- */

function diffExceptions(a: PolicyVersion, b: PolicyVersion): ExceptionDiff[] {
  const labelIn = (v: PolicyVersion) => (k: string) => v.criteria.find((c) => c.key === k)?.displayLabel ?? k;
  const textOf = (v: PolicyException, ver: PolicyVersion) => describeException(v, labelIn(ver));
  const aBy = new Map(a.exceptions.map((e) => [e.key, e]));
  const bBy = new Map(b.exceptions.map((e) => [e.key, e]));
  const out: ExceptionDiff[] = [];
  for (const eb of b.exceptions) {
    const ea = aBy.get(eb.key);
    if (!ea) {
      out.push({ key: eb.key, kind: "added", label: eb.displayLabel, afterText: textOf(eb, b), changes: [], citationChanges: [] });
      continue;
    }
    const changes = compact<ValueChange>([
      ea.displayLabel !== eb.displayLabel ? { label: "Label", from: ea.displayLabel, to: eb.displayLabel } : null,
      listChange("Triggers", ea.triggers, eb.triggers),
      same(ea.waivesCriterionKeys, eb.waivesCriterionKeys)
        ? null
        : {
            label: "Waiver scope",
            from: ea.waivesCriterionKeys.map(labelIn(a)).join(", ") || "(none)",
            to: eb.waivesCriterionKeys.map(labelIn(b)).join(", ") || "(none)",
            emphasis: "waiver_scope",
          },
      ea.evaluationMode !== eb.evaluationMode ? { label: "Evaluation mode", from: fmt(ea.evaluationMode), to: fmt(eb.evaluationMode) } : null,
      ea.assumption !== eb.assumption ? { label: "Assumption", from: fmt(ea.assumption), to: fmt(eb.assumption) } : null,
    ]);
    const cites = citationChanges(ea, eb);
    out.push({
      key: eb.key,
      kind: changes.length || cites.length ? "changed" : "unchanged",
      label: eb.displayLabel,
      beforeText: textOf(ea, a),
      afterText: textOf(eb, b),
      changes,
      citationChanges: cites,
    });
  }
  for (const ea of a.exceptions) {
    if (!bBy.has(ea.key)) out.push({ key: ea.key, kind: "removed", label: ea.displayLabel, beforeText: textOf(ea, a), changes: [], citationChanges: [] });
  }
  return out;
}

/* ---------- top level ---------- */

/** How many things changed, as a person would count them: one per criterion, waiver or setting. */
export function countChanges(d: VersionDiff): number {
  const rows = (xs: Array<{ kind: string }>) => xs.filter((x) => x.kind !== "unchanged").length;
  return rows(d.criteria) + rows(d.exceptions) + d.applicability.length + d.properties.length + d.source.length;
}

export function diffVersions(a: PolicyVersion, b: PolicyVersion): VersionDiff {
  const criteria = diffCriteria(a, b);
  const exceptions = diffExceptions(a, b);

  const applicability = compact<ValueChange>([
    listChange("CPT codes", a.applicability.cptCodes, b.applicability.cptCodes),
    same(a.applicability.settings, b.applicability.settings)
      ? null
      : { label: "Settings", from: fmt(a.applicability.settings === "all" ? "all settings" : a.applicability.settings), to: fmt(b.applicability.settings === "all" ? "all settings" : b.applicability.settings) },
    a.logic !== b.logic ? { label: "Logic", from: a.logic, to: b.logic } : null,
  ]);

  const properties = propertyChanges(a.properties, b.properties);

  const source = compact<ValueChange>([
    a.sourceRevisionLabel !== b.sourceRevisionLabel ? { label: "Insurer revision", from: fmt(a.sourceRevisionLabel), to: fmt(b.sourceRevisionLabel) } : null,
    a.sourceDocument !== b.sourceDocument ? { label: "Source document", from: fmt(a.sourceDocument), to: fmt(b.sourceDocument) } : null,
    a.sourceDocumentHash !== b.sourceDocumentHash ? { label: "Source document hash", from: fmt(a.sourceDocumentHash), to: fmt(b.sourceDocumentHash) } : null,
  ]);

  const identical =
    criteria.every((c) => c.kind === "unchanged") &&
    exceptions.every((e) => e.kind === "unchanged") &&
    applicability.length + properties.length + source.length === 0;

  return {
    a: { id: a.id, versionNumber: a.versionNumber },
    b: { id: b.id, versionNumber: b.versionNumber },
    criteria,
    exceptions,
    applicability,
    properties,
    source,
    identical,
  };
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  other: number;
  lines: string[];
}

/** Short, human lines for the publish modal: "Symptom duration: Minimum weeks 4 → 6". */
export function summarizeDiff(d: VersionDiff): DiffSummary {
  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const c of d.criteria) {
    if (c.kind === "added") { added++; lines.push(`Added criterion: ${c.label}`); }
    else if (c.kind === "removed") { removed++; lines.push(`Removed criterion: ${c.label}`); }
    else if (c.kind === "changed") {
      changed++;
      const parts = [...c.changes, ...c.citationChanges.map((x) => ({ ...x, from: "…", to: "…" }))];
      lines.push(`${c.label}: ${parts.map((p) => `${p.label} ${p.from} → ${p.to}`).join("; ")}`);
    }
  }
  for (const e of d.exceptions) {
    if (e.kind === "added") lines.push(`Added exception: ${e.label}`);
    else if (e.kind === "removed") lines.push(`Removed exception: ${e.label}`);
    else if (e.kind === "changed") lines.push(`Exception ${e.label}: ${e.changes.map((p) => `${p.label} changed`).join("; ") || "citation changed"}`);
  }
  let other = 0;
  for (const g of [d.applicability, d.properties, d.source]) {
    for (const c of g) { other++; lines.push(`${c.label}: ${c.from} → ${c.to}`); }
  }
  return { added, removed, changed, other, lines };
}

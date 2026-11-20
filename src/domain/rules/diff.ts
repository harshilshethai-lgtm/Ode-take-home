// Plain-English diff between two versions. Criteria and exceptions are matched by stable `key`, never by id.

import { describeChannels, describeCriterion, describeException, INCOMPLETE_LABEL } from "./describe";
import { getPrimitive } from "./primitives/registry";
import { schemaToFields } from "./schemaFields";
import type { Criterion, PolicyException, PolicyVersion } from "./types";

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
  section: string;
  excerpt: string;
  isAssumption: boolean;
  interpretationNote: string | null;
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
  submission: ValueChange[];
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
    section: c.sourceCitation.section,
    excerpt: c.sourceCitation.excerpt,
    isAssumption: c.isAssumption,
    interpretationNote: c.interpretationNote,
    evaluationMode: c.evaluationMode,
  };
}

function paramChanges(a: Criterion, b: Criterion): ValueChange[] {
  if (a.type !== b.type) {
    const la = getPrimitive(a.type)?.label ?? a.type;
    const lb = getPrimitive(b.type)?.label ?? b.type;
    return [{ label: "Rule type", from: la, to: lb }];
  }
  const prim = getPrimitive(a.type);
  const fields = prim ? schemaToFields(prim.paramsSchema) : [];
  const names = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  const out: ValueChange[] = [];
  for (const name of names) {
    if (same(a.params[name], b.params[name])) continue;
    out.push({ label: fields.find((f) => f.name === name)?.label ?? name, from: fmt(a.params[name]), to: fmt(b.params[name]) });
  }
  return out;
}

function citationChanges(a: { sourceCitation: { section: string; excerpt: string } }, b: { sourceCitation: { section: string; excerpt: string } }): ValueChange[] {
  const out: ValueChange[] = [];
  if (a.sourceCitation.section !== b.sourceCitation.section) out.push({ label: "Citation section", from: a.sourceCitation.section, to: b.sourceCitation.section });
  if (a.sourceCitation.excerpt !== b.sourceCitation.excerpt) out.push({ label: "Citation excerpt", from: a.sourceCitation.excerpt, to: b.sourceCitation.excerpt });
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
      ...paramChanges(ca, cb),
      ...compact([
        ca.displayLabel !== cb.displayLabel ? { label: "Label", from: ca.displayLabel, to: cb.displayLabel } : null,
        ca.evaluationMode !== cb.evaluationMode ? { label: "Evaluation mode", from: fmt(ca.evaluationMode), to: fmt(cb.evaluationMode) } : null,
        ca.isAssumption !== cb.isAssumption ? { label: "Marked as assumption", from: fmt(ca.isAssumption), to: fmt(cb.isAssumption) } : null,
        ca.interpretationNote !== cb.interpretationNote ? { label: "Interpretation note", from: fmt(ca.interpretationNote), to: fmt(cb.interpretationNote) } : null,
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
      ea.isAssumption !== eb.isAssumption ? { label: "Marked as assumption", from: fmt(ea.isAssumption), to: fmt(eb.isAssumption) } : null,
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

export function diffVersions(a: PolicyVersion, b: PolicyVersion): VersionDiff {
  const criteria = diffCriteria(a, b);
  const exceptions = diffExceptions(a, b);

  const applicability = compact<ValueChange>([
    listChange("CPT codes", a.applicability.cptCodes, b.applicability.cptCodes),
    same(a.applicability.planTypes, b.applicability.planTypes)
      ? null
      : { label: "Plan types", from: fmt(a.applicability.planTypes === "all" ? "all plans" : a.applicability.planTypes), to: fmt(b.applicability.planTypes === "all" ? "all plans" : b.applicability.planTypes) },
    same(a.applicability.settings, b.applicability.settings)
      ? null
      : { label: "Settings", from: fmt(a.applicability.settings === "all" ? "all settings" : a.applicability.settings), to: fmt(b.applicability.settings === "all" ? "all settings" : b.applicability.settings) },
    a.logic !== b.logic ? { label: "Logic", from: a.logic, to: b.logic } : null,
  ]);

  const submission = compact<ValueChange>([
    same(a.submission.channels, b.submission.channels) ? null : { label: "Channels", from: describeChannels(a.submission.channels), to: describeChannels(b.submission.channels) },
    listChange("Required attachments", a.submission.requiredAttachments, b.submission.requiredAttachments),
    a.submission.incompleteRequestHandling !== b.submission.incompleteRequestHandling
      ? { label: "Incomplete requests", from: INCOMPLETE_LABEL[a.submission.incompleteRequestHandling], to: INCOMPLETE_LABEL[b.submission.incompleteRequestHandling] }
      : null,
  ]);

  const source = compact<ValueChange>([
    a.sourceRevisionLabel !== b.sourceRevisionLabel ? { label: "Insurer revision", from: fmt(a.sourceRevisionLabel), to: fmt(b.sourceRevisionLabel) } : null,
    a.sourceDocument !== b.sourceDocument ? { label: "Source document", from: fmt(a.sourceDocument), to: fmt(b.sourceDocument) } : null,
    a.sourceDocumentHash !== b.sourceDocumentHash ? { label: "Source document hash", from: fmt(a.sourceDocumentHash), to: fmt(b.sourceDocumentHash) } : null,
  ]);

  const identical =
    criteria.every((c) => c.kind === "unchanged") &&
    exceptions.every((e) => e.kind === "unchanged") &&
    applicability.length + submission.length + source.length === 0;

  return {
    a: { id: a.id, versionNumber: a.versionNumber },
    b: { id: b.id, versionNumber: b.versionNumber },
    criteria,
    exceptions,
    applicability,
    submission,
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
  for (const g of [d.applicability, d.submission, d.source]) {
    for (const c of g) { other++; lines.push(`${c.label}: ${c.from} → ${c.to}`); }
  }
  return { added, removed, changed, other, lines };
}

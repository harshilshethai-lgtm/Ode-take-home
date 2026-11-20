// Checklist presentation. Statuses come from the rule engine when the packet has
// extracted facts, and from the recorded check result otherwise. This module only
// maps those statuses onto labels and layout. It does not decide them.

import { buildSeedDb } from "@/data/rules/seed";
import type { CaseRecord } from "@/domain/caseRecord";
import { buildCaseRecord } from "@/domain/caseRecord";
import type { CheckResult, CheckRow, ReviewPanel } from "@/domain/review/types";
import { daysBetween } from "@/domain/rules/dates";
import { historyReviewed, study, symptomOnset, treatment } from "@/domain/rules/factBuilders";
import { evaluateOrder } from "@/domain/rules/engine";
import type { CriterionResult, CriterionStatus, EvaluationOutcome, Fact, FailureType, RulesSnapshot } from "@/domain/rules/types";
import type { Order } from "@/domain/types";
import type { ReasonDetail } from "@/domain/priorAuth/types";
import { versionHref } from "@/lib/evalNotice";
import { DEMO_NOW } from "@/data/orders";
import { parseDemoInstant } from "@/lib/demoClock";
import { fmtCountdown } from "@/lib/format";
import { CRITERION_STATUS_COUNT, NOT_MET_TAG, policyVersionLabel } from "@/lib/labels";

export interface CitedQuote {
  quote: string;
  page: number;
  docId: string;
  /** Packet file key, or "policy" for the insurer PDF. */
  file: string;
}

export interface EvidenceLine {
  source: string;
  value: string;
  cite: CitedQuote | null;
  /** Set when an external system was actually queried. */
  checked: { system: string; lastRun: string } | null;
}

export interface CriterionRowModel {
  id: string;
  label: string;
  fact: string;
  status: CriterionStatus;
  /** "Fixable with records", "Clinical", or the exception name when waived. */
  tag: string | null;
  close: boolean;
  excerpt: string | null;
  policyCite: CitedQuote | null;
  evidence: EvidenceLine[];
  reason: string | null;
  fix: string | null;
}

export interface DataCheckModel {
  id: string;
  label: string;
  fact: string;
  status: CriterionStatus;
  cite: CitedQuote | null;
  epic: { system: string; lastRun: string } | null;
}

export interface ChecklistModel {
  verdict: string;
  criteria: { rows: CriterionRowModel[]; defaultOpen: boolean; count: string } | null;
  /** Shown instead of criterion rows when coverage has not been resolved. */
  waiting: string | null;
  dataChecks: { rows: DataCheckModel[]; defaultOpen: boolean; count: string } | null;
  policyLabel: string | null;
  policyHref: string | null;
}

const STATUS_RANK: Record<CriterionStatus, number> = {
  not_met: 0,
  unknown: 1,
  needs_review: 2,
  waived: 3,
  met: 4,
};

const FROM_CHECK: Record<CheckResult, CriterionStatus> = {
  MET: "met",
  FIXED: "met",
  NOT_MET: "not_met",
  UNCLEAR: "unknown",
  WAIVED: "waived",
  EXCEPTION_MET: "waived",
};

const ABSENT = /not (stated|mentioned|found|in the|on the|on his|checked)|no [a-z ]{0,24}(x-?ray|mri)|isn't in the order|not in the fax/i;

let cachedDb: ReturnType<typeof buildSeedDb> | null = null;
function rulesDb() {
  cachedDb ??= buildSeedDb();
  return cachedDb;
}

function policyIdOf(ref: string | null): string {
  return ref?.split(" ")[0] ?? "";
}

function packetFile(record: CaseRecord): string {
  return record.documents[0]?.file ?? "packet";
}

export function lastRunLabel(iso: string): string {
  const at = parseDemoInstant(iso);
  const mins = Math.round((at.getTime() - DEMO_NOW.getTime()) / 60000);
  if (Math.abs(mins) < 1) return "just now";
  return fmtCountdown(at, DEMO_NOW);
}

export function checkedLine(system: string, lastRun: string): string {
  return `Checked: ${system} · last run ${lastRun}`;
}

function isAbsent(value: string): boolean {
  return ABSENT.test(value);
}

function monthDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(m)}/${Number(d)}`;
}

function needDays(snapshot: RulesSnapshot | null, key: string): number | null {
  const weeks = snapshot?.criteria.find((c) => c.key === key)?.properties.find((p) => p.key === "duration" && p.unit === "weeks")?.value;
  return typeof weeks === "number" ? weeks * 7 : null;
}

interface Span {
  name: string;
  start: string;
  end: string;
}

const MODALITY_NAME: Record<string, string> = {
  physical_therapy: "PT",
  home_exercise_program: "HEP",
  prescription_medication: "Medication",
  chiropractic: "Chiropractic",
};

function spansOf(facts: Fact[]): Span[] {
  return facts
    .filter((fact) => fact.type === "conservative_treatment")
    .map((fact) => {
      const value = fact.value as { modality?: string; startDate?: string; endDate?: string };
      const modality = value.modality ?? "";
      return {
        name: MODALITY_NAME[modality] ?? modality.replace(/_/g, " "),
        start: value.startDate ?? fact.date,
        end: value.endDate ?? fact.date,
      };
    })
    .filter((span) => span.start && span.end);
}

function coveredDays(spans: Span[]): number {
  const sorted = [...spans].sort((a, b) => a.start.localeCompare(b.start));
  let total = 0;
  let cur: { start: string; end: string } | null = null;
  for (const span of sorted) {
    if (cur && span.start <= cur.end) {
      if (span.end > cur.end) cur = { start: cur.start, end: span.end };
    } else {
      if (cur) total += daysBetween(cur.start, cur.end);
      cur = { start: span.start, end: span.end };
    }
  }
  if (cur) total += daysBetween(cur.start, cur.end);
  return total;
}

/** "PT 9/21–10/31 + HEP to 11/9 = 49 days (need 42)". Display only; the engine already decided. */
export function treatmentFact(facts: Fact[], need: number): string | null {
  const spans = spansOf(facts);
  if (spans.length === 0 || need <= 0) return null;
  const sorted = [...spans].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const shown: Span[] = [];
  let end = "";
  for (const span of sorted) {
    if (shown.length > 0 && span.end <= end) continue;
    shown.push(span);
    if (span.end > end) end = span.end;
  }
  const [first, ...rest] = shown;
  const head = `${first.name} ${monthDay(first.start)}–${monthDay(first.end)}`;
  const tail = rest.map((span) => `${span.name} to ${monthDay(span.end)}`).join(" + ");
  const days = coveredDays(spans);
  return `${tail ? `${head} + ${tail}` : head} = ${days} days (need ${need})`;
}

function onsetFact(facts: Fact[], serviceDate: string, need: number): { text: string; days: number } | null {
  const onset = facts.filter((fact) => fact.type === "symptom_onset").sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!onset) return null;
  const days = daysBetween(onset.date, serviceDate);
  return { text: `Onset ${monthDay(onset.date)} = ${days} days (need ${need})`, days };
}

function closeTo(actual: number, need: number): boolean {
  return Math.abs(actual - need) <= 7;
}

function reasonText(reason: string): string {
  return reason.replace(/^(Met|Not met|Unknown|Needs review|Waived)\.\s*/, "");
}

function policyPage(snapshot: RulesSnapshot | null): number | null {
  const match = /#page=(\d+)/.exec(snapshot?.sourceDocument ?? "");
  return match ? Number(match[1]) : null;
}

function policyLabelOf(snapshot: RulesSnapshot | null, ref: string | null): { label: string; href: string } | null {
  if (snapshot) {
    return {
      label: policyVersionLabel(snapshot.externalPolicyId, snapshot.sourceRevisionLabel, snapshot.versionNumber),
      href: versionHref(snapshot.policyId, snapshot.versionId),
    };
  }
  const externalId = policyIdOf(ref);
  if (!externalId) return null;
  const db = rulesDb();
  const policy = db.policies.find((item) => item.externalPolicyId === externalId);
  const version = policy ? db.versions.find((item) => item.policyId === policy.id && item.effectiveTo === null) : null;
  if (!policy || !version) return null;
  return {
    label: policyVersionLabel(policy.externalPolicyId, version.sourceRevisionLabel, version.versionNumber),
    href: versionHref(policy.id, version.id),
  };
}

/** Packet facts for the two cases whose recorded check disagrees with the policy, or whose day math has to be shown. */
function extractedFacts(order: Order): { facts: Fact[]; serviceDate: string; planType: string; laterality?: "left" | "right" } | null {
  if (order.id === "case-1-kirk") {
    return {
      serviceDate: "2026-11-18",
      planType: "commercial_ppo",
      facts: [
        symptomOnset("2026-09-14", { excerpt: "Low back pain radiating down R leg x 8 weeks.", doc: "packet" }),
        treatment({
          modality: "physical_therapy",
          start: "2026-09-21",
          end: "2026-10-31",
          response: true,
          excerpt: "Dates of care: 9/21/2026 to 10/31/2026",
          doc: "packet",
        }),
        treatment({
          modality: "home_exercise_program",
          start: "2026-10-31",
          end: "2026-11-09",
          response: true,
          excerpt: "home exercise program",
          doc: "packet",
        }),
        study({
          studyType: "xray",
          bodySite: "lumbar_spine",
          date: "2026-10-02",
          excerpt: "XR LUMBAR SPINE 2-3 VIEWS, 10/02/2026 9:14 AM",
          doc: "packet",
        }),
        historyReviewed("2026-11-09", { excerpt: "No MRI of the lumbar spine on record.", doc: "packet" }),
      ],
    };
  }
  if (order.id === "case-2-scott") {
    return {
      serviceDate: "2026-11-10",
      planType: "commercial_hmo",
      laterality: "right",
      facts: [
        symptomOnset("2026-09-22", { excerpt: "R knee pain and clicking x 7 wks", doc: "packet" }),
        treatment({
          modality: "physical_therapy",
          start: "2026-09-29",
          end: "2026-11-10",
          sourceType: "patient_reported",
          excerpt: "about six weeks",
          doc: "packet",
        }),
        study({
          studyType: "xray",
          bodySite: "knee",
          date: "2026-09-24",
          laterality: "right",
          excerpt: "XR KNEE RIGHT 3 VIEWS, 09/24/2026",
          doc: "packet",
        }),
      ],
    };
  }
  return null;
}

function runEngine(order: Order): EvaluationOutcome | null {
  const extracted = extractedFacts(order);
  if (!extracted) return null;
  const db = rulesDb();
  const externalId = policyIdOf(order.policyRef);
  const policy = db.policies.find((item) => item.externalPolicyId === externalId);
  if (!policy) return null;
  const { outcome } = evaluateOrder(db, {
    payerId: policy.payerId,
    planType: extracted.planType,
    cptCode: order.cpt ?? "",
    serviceDate: extracted.serviceDate,
    laterality: extracted.laterality,
    setting: "outpatient",
    facts: extracted.facts,
  });
  return outcome.rulesSnapshot ? outcome : null;
}

function failureType(snapshot: RulesSnapshot | null, key: string): FailureType | undefined {
  const found = snapshot?.criteria.find((c) => c.key === key)?.failureType;
  if (found) return found;
  const db = rulesDb();
  for (const version of db.versions) {
    const criterion = version.criteria.find((c) => c.key === key);
    if (criterion) return criterion.failureType;
  }
  return undefined;
}

function tagFor(status: CriterionStatus, type: FailureType | undefined, exceptionName: string | null): string | null {
  if (status === "waived") return exceptionName;
  if (status !== "not_met") return null;
  if (type === "fixable") return NOT_MET_TAG.fixable;
  return NOT_MET_TAG.clinical;
}

function mentions(detail: string, key: string): boolean {
  const text = detail.toLowerCase();
  if (key === "conservative_care") return /conserv|therapy|\bpt\b/.test(text);
  if (key === "prior_xray") return /x-?ray|imaging/.test(text);
  if (key === "no_recent_mri") return /mri|imaging history/.test(text);
  if (key === "symptom_duration") return /symptom|duration|pain/.test(text);
  return text.includes(key.replace(/_/g, " "));
}

function fixFor(order: Order, key: string, status: CriterionStatus, type: FailureType | undefined): string | null {
  if (status !== "not_met" && status !== "unknown") return null;
  if (status === "not_met" && type === "clinical") return null;
  const details: ReasonDetail[] = [order.detail, ...order.otherIssues.map((issue) => issue.detail)];
  const match = details.find((detail) => detail.document && detail.source && mentions(String(detail.criterion ?? ""), key));
  if (!match?.document || !match.source) return null;
  return `Get ${match.document} from ${match.source}`;
}

function packetCites(record: CaseRecord, key: string): Array<{ source: string; quote: string; page: number }> {
  const byId: Record<string, string> = {
    "1": "symptom_duration",
    "2": "conservative_care",
    "2a": "symptom_duration",
    "2b": "conservative_care",
    "2c": "prior_xray",
    "2d": "no_recent_mri",
    "3": "prior_xray",
    "4": "no_recent_mri",
  };
  const row = record.criteria.find((item) => (byId[item.id] ?? item.id) === key);
  return (row?.cites ?? []).map((cite) => ({ source: row?.line ?? "Record", quote: cite.quote, page: cite.page }));
}

function evidenceFromFacts(result: CriterionResult, record: CaseRecord, file: string): EvidenceLine[] {
  if (result.status === "unknown" || isAbsent(result.reason)) {
    return [{ source: "Packet", value: "Not found in the packet", cite: null, checked: null }];
  }
  const cites = packetCites(record, result.criterionKey);
  if (cites.length > 0) {
    return cites.map((cite) => ({
      source: cite.source,
      value: cite.quote,
      cite: { quote: cite.quote, page: cite.page, docId: "packet", file },
      checked: null,
    }));
  }
  return result.evidenceRefs
    .filter((ref) => ref.excerpt && !isAbsent(ref.excerpt))
    .map((ref) => ({
      source: "Record",
      value: ref.excerpt,
      cite: null,
      checked: null,
    }));
}

function factLine(result: CriterionResult, facts: Fact[], serviceDate: string, need: number | null): { text: string; close: boolean } {
  if (result.status === "not_met" && /patient-reported|does not accept/i.test(result.reason) && need) {
    return { text: `Patient-reported only · 0 of ${need} days documented`, close: false };
  }
  if (result.criterionKey === "conservative_care" && need) {
    const text = treatmentFact(facts, need);
    if (text) return { text, close: closeTo(coveredDays(spansOf(facts)), need) };
  }
  if (result.criterionKey === "symptom_duration" && need) {
    const onset = onsetFact(facts, serviceDate, need);
    if (onset) return { text: onset.text, close: closeTo(onset.days, need) };
  }
  if (result.status === "unknown") return { text: "Not found in the packet", close: false };
  if (result.criterionKey === "prior_xray") {
    const xray = facts.find((fact) => fact.type === "imaging_study");
    if (xray) return { text: `X-ray ${monthDay(xray.date)}`, close: false };
  }
  if (result.criterionKey === "no_recent_mri" && result.status === "met") return { text: "No MRI on record", close: false };
  return { text: reasonText(result.reason), close: false };
}

function fromEngine(order: Order, outcome: EvaluationOutcome, record: CaseRecord): CriterionRowModel[] {
  const snapshot = outcome.rulesSnapshot;
  const file = packetFile(record);
  const page = policyPage(snapshot);
  const extracted = extractedFacts(order);
  const facts = extracted?.facts ?? [];
  const serviceDate = extracted?.serviceDate ?? "";
  return outcome.criterionResults.map((result) => {
    const type = failureType(snapshot, result.criterionKey);
    const exception = result.waivedByExceptionKey
      ? (snapshot?.exceptions.find((item) => item.key === result.waivedByExceptionKey)?.displayLabel ?? null)
      : null;
    const need = needDays(snapshot, result.criterionKey);
    const fact = factLine(result, facts, serviceDate, need);
    return {
      id: result.criterionKey,
      label: result.displayLabel,
      fact: fact.text,
      status: result.status,
      tag: tagFor(result.status, type, exception),
      close: fact.close,
      excerpt: result.excerpt || null,
      policyCite:
        result.excerpt && page
          ? { quote: result.excerpt, page, docId: "policy", file: "policy" }
          : null,
      evidence: evidenceFromFacts(result, record, file),
      reason: reasonText(result.reason),
      fix: fixFor(order, result.criterionKey, result.status, type),
    };
  });
}

function fromPanel(order: Order, panel: ReviewPanel, record: CaseRecord, snapshot: RulesSnapshot | null): CriterionRowModel[] {
  const file = packetFile(record);
  const page = policyPage(snapshot);
  const rows = panel.checks.criteria.rows.filter((row) => !row.id.startsWith("waiver:") && !row.id.startsWith("exception:"));
  const waiver = panel.checks.criteria.rows.find((row) => row.id.startsWith("waiver:") || row.id.startsWith("exception:"));
  return rows.map((row) => {
    const status = FROM_CHECK[row.result];
    const type = failureType(snapshot, row.id);
    const absent = isAbsent(row.found) || isAbsent(row.quote ?? "");
    const excerpt = snapshot?.criteria.find((c) => c.key === row.id)?.excerpt ?? null;
    const exception = status === "waived" ? (row.found.replace(/^Waiver:\s*/i, "") || waiver?.label.replace(/^Waiver:\s*/i, "") || null) : null;
    const cites = packetCites(record, row.id);
    const evidence: EvidenceLine[] = absent
      ? [{ source: "Packet", value: "Not found in the packet", cite: null, checked: null }]
      : cites.length > 0
        ? cites.map((cite) => ({
            source: cite.source,
            value: cite.quote,
            cite: { quote: cite.quote, page: cite.page, docId: "packet", file },
            checked: null,
          }))
        : row.quote && row.page
          ? [{ source: "Record", value: row.found, cite: { quote: row.quote, page: row.page, docId: row.docId ?? "packet", file }, checked: null }]
          : [];
    return {
      id: row.id,
      label: row.label,
      fact: absent ? "Not found in the packet" : row.found,
      status,
      tag: tagFor(status, type, exception),
      close: false,
      excerpt,
      policyCite: excerpt && page ? { quote: excerpt, page, docId: "policy", file: "policy" } : null,
      evidence,
      reason: absent ? "Not found in the packet." : row.found,
      fix: fixFor(order, row.id, status, type),
    };
  });
}

function sortStatus<T extends { status: CriterionStatus }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => STATUS_RANK[a.row.status] - STATUS_RANK[b.row.status] || a.index - b.index)
    .map((item) => item.row);
}

export function criteriaVerdict(rows: Array<{ status: CriterionStatus }>, waiting: boolean): string {
  if (waiting) return "Insurer criteria: waiting on coverage";
  if (rows.length === 0) return "";
  const met = rows.filter((row) => row.status === "met").length;
  const parts = [`Insurer criteria: ${met} of ${rows.length} met`];
  for (const status of ["not_met", "unknown", "needs_review", "waived"] as const) {
    const count = rows.filter((row) => row.status === status).length;
    if (count) parts.push(`${count} ${CRITERION_STATUS_COUNT[status]}`);
  }
  return parts.join(" · ");
}

function dataCheck(row: CheckRow, file: string, epic: { system: string; lastRun: string } | null): DataCheckModel {
  const status = FROM_CHECK[row.result];
  const absent = isAbsent(row.found);
  const cite = !absent && row.quote && row.page ? { quote: row.quote, page: row.page, docId: row.docId ?? "packet", file } : null;
  return {
    id: row.id,
    label: row.label,
    fact: absent ? "Not found in the packet" : row.found,
    status,
    cite,
    epic: cite ? null : epic,
  };
}

export function presentChecklist(order: Order, panel: ReviewPanel, record: CaseRecord = buildCaseRecord(order)): ChecklistModel {
  const outcome = runEngine(order);
  const snapshot = outcome?.rulesSnapshot ?? snapshotFromRef(order.policyRef);
  const policy = policyLabelOf(snapshot, order.policyRef);
  const coverageFailed = panel.coverage.some((row) => row.id === "CV-1" && row.result === "NOT_MET");
  const criteriaRows = outcome ? fromEngine(order, outcome, record) : fromPanel(order, panel, record, snapshot);
  const rows = sortStatus(criteriaRows);
  const waiting = coverageFailed && rows.length > 0;
  const evaluated = panel.checks.evaluatedAt ? lastRunLabel(panel.checks.evaluatedAt) : null;
  const epic = evaluated ? { system: "Epic", lastRun: evaluated } : null;
  const file = packetFile(record);
  const coverage = panel.coverage.filter((row) => row.id === "CV-1" || (row.id === "CV-2" && order.linkedApproval));
  const consistency = panel.checks.consistency.filter((row) => row.id !== "CO-5");
  const checks = sortStatus([...coverage, ...consistency].map((row) => dataCheck(row, file, row.id === "CV-1" ? epic : null)));
  const passed = checks.filter((row) => row.status === "met" || row.status === "waived").length;
  return {
    verdict: rows.length ? criteriaVerdict(waiting ? [] : rows, waiting) : "",
    criteria: rows.length
      ? {
          rows: waiting ? [] : rows,
          defaultOpen: waiting || rows.some((row) => row.status !== "met"),
          count: waiting ? String(rows.length) : `${rows.filter((row) => row.status === "met").length}/${rows.length}`,
        }
      : null,
    waiting: waiting ? "Waiting on coverage" : null,
    dataChecks: checks.length
      ? {
          rows: checks,
          defaultOpen: checks.some((row) => row.status !== "met" && row.status !== "waived"),
          count: passed === checks.length ? `${checks.length}/${checks.length} passed` : `${passed}/${checks.length}`,
        }
      : null,
    policyLabel: policy?.label ?? null,
    policyHref: policy?.href ?? null,
  };
}

function snapshotFromRef(ref: string | null): RulesSnapshot | null {
  const externalId = policyIdOf(ref);
  if (!externalId) return null;
  const db = rulesDb();
  const policy = db.policies.find((item) => item.externalPolicyId === externalId);
  const version = policy ? db.versions.find((item) => item.policyId === policy.id && item.effectiveTo === null) : null;
  if (!policy || !version) return null;
  const payer = db.payers.find((item) => item.id === policy.payerId);
  if (!payer) return null;
  return {
    payerName: payer.name,
    policyId: policy.id,
    externalPolicyId: policy.externalPolicyId,
    title: policy.title,
    bodySite: policy.bodySite,
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceRevisionLabel: version.sourceRevisionLabel,
    sourceDocument: version.sourceDocument,
    sourceDocumentHash: version.sourceDocumentHash,
    applicability: version.applicability,
    logic: version.logic,
    properties: version.properties,
    criteria: version.criteria.map((c) => ({
      key: c.key,
      ref: c.ref,
      displayLabel: c.displayLabel,
      properties: c.properties,
      evaluationMode: c.evaluationMode,
      failureType: c.failureType,
      excerpt: c.excerpt,
      isAssumption: c.properties.some((p) => !!p.assumption),
      text: c.excerpt,
    })),
    exceptions: version.exceptions.map((e) => ({
      key: e.key,
      ref: e.ref,
      displayLabel: e.displayLabel,
      triggers: e.triggers,
      waivesCriterionKeys: e.waivesCriterionKeys,
      evaluationMode: e.evaluationMode,
      excerpt: e.excerpt,
      assumption: e.assumption,
    })),
  };
}

export interface QuoteCheck {
  quote: string;
  page: number;
  file: string;
}

export function displayedQuotes(model: ChecklistModel, card: EvidenceLine[]): QuoteCheck[] {
  const out: QuoteCheck[] = [];
  const push = (cite: CitedQuote | null) => {
    if (cite?.quote) out.push({ quote: cite.quote, page: cite.page, file: cite.file });
  };
  for (const row of model.criteria?.rows ?? []) {
    push(row.policyCite);
    for (const line of row.evidence) push(line.cite);
  }
  for (const row of model.dataChecks?.rows ?? []) push(row.cite);
  for (const line of card) push(line.cite);
  return out;
}

/** Evidence card: consistency and coverage only. Criterion evidence lives on the checklist row. */
export function presentEvidenceCard(order: Order, panel: ReviewPanel): EvidenceLine[] {
  const record = buildCaseRecord(order);
  const file = packetFile(record);
  const criterionIds = new Set(panel.checks.criteria.rows.map((row) => row.id));
  const lines: EvidenceLine[] = [];
  for (const block of panel.evidence) {
    if (criterionIds.has(block.forCheckId)) continue;
    for (const row of block.rows) {
      if (isAbsent(row.value) || isAbsent(row.quote)) {
        lines.push({ source: row.source, value: "Not found in the packet", cite: null, checked: null });
        continue;
      }
      lines.push({
        source: row.source,
        value: row.value,
        cite: row.quote ? { quote: row.quote, page: row.page, docId: row.docId, file } : null,
        checked: null,
      });
    }
  }
  return lines;
}

export function composeAiSummary(explanation: string, action: string): string {
  const stripped = explanation.replace(/\s*Suggested:\s*[^.]+\.?\s*/gi, " ").replace(/\s+/g, " ").trim();
  const verdict = firstSentence(stripped);
  const next = firstSentence(action.trim());
  if (!verdict) return withPeriod(next);
  if (!next) return withPeriod(verdict);
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const combined = norm(verdict).includes(norm(next)) || norm(next).includes(norm(verdict)) ? withPeriod(verdict) : `${withPeriod(verdict)} ${withPeriod(next)}`;
  // "Dr." would count as its own sentence in the copy budget.
  return combined.replace(/\b(Dr|Mr|Mrs|Ms|St)\.(?=\s)/g, "$1");
}

function firstSentence(text: string): string {
  const end = /[.!](?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = end.exec(text))) {
    const lead = text.slice(0, match.index).trim();
    if (/(?:^|\s)(?:Dr|Mr|Mrs|Ms|St)$/.test(lead)) continue;
    return text.slice(0, match.index + 1).trim();
  }
  return text.trim();
}

function withPeriod(text: string): string {
  if (!text) return text;
  return /[.!]$/.test(text) ? text : `${text}.`;
}

export function policyViewerPage(ref: string | null): number | null {
  const id = policyIdOf(ref);
  if (id === "RAD-114") return 1;
  if (id === "MSK-207") return 2;
  if (id === "IMG-330") return 3;
  return null;
}

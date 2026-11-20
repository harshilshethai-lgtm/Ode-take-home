import { ORDER_STATUS_INFO } from "./catalog";
import { explainReason, fill, reasonChip, stepProgress, whatToDo, type StatusAction } from "./reasons";
import type { OrderStatus, ProcessingStep, ReasonCode, ReasonDetail, OtherIssue, UserRole } from "./types";

export interface SummaryAction {
  id: string;
  label: string;
  to: OrderStatus | null;
  reason: ReasonCode | null;
  primary: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

export interface SummaryIssue {
  chip: string;
  code: ReasonCode;
  explanation: string;
}

export interface SummaryTrailStep {
  label: string;
  /** Processing progress, shown only when the trail is expanded. */
  steps: string[];
}

export interface CaseSummary {
  status: OrderStatus;
  statusLabel: string;
  chip: string | null;
  explanation: string;
  whatToDo: string;
  deadline: string | null;
  actions: SummaryAction[];
  otherIssues: SummaryIssue[];
  trail: SummaryTrailStep[];
  scanAtRisk: boolean;
}

export interface SummaryInput {
  status: OrderStatus;
  reason: ReasonCode | null;
  step: ProcessingStep | null;
  detail: ReasonDetail;
  otherIssues: OtherIssue[];
  role: UserRole;
  actions: Array<Pick<StatusAction, "id" | "label" | "to" | "reason"> & { disabled?: boolean; disabledReason?: string | null }>;
  deadline?: string | null;
  scanAtRisk?: boolean;
  /** Status and reason history. Processing steps sit on the processing entries. */
  trail?: Array<{ status: OrderStatus; reason: ReasonCode | null; steps?: ProcessingStep[]; detail?: ReasonDetail }>;
}

export function buildCaseSummary(input: SummaryInput): CaseSummary {
  const explanation = input.reason ? explainReason(input.reason, input.detail) : input.step ? stepProgress(input.step, input.detail) : ORDER_STATUS_INFO[input.status].meaning;
  const todo = input.reason ? whatToDo(input.reason, input.detail) : "No person needs to act. The pipeline is still working.";
  return {
    status: input.status,
    statusLabel: ORDER_STATUS_INFO[input.status].label,
    chip: input.status === "PROCESSING" ? null : input.reason ? reasonChip(input.reason) : null,
    explanation,
    whatToDo: todo,
    deadline: input.deadline ?? null,
    actions: input.actions.map((action, index) => ({
      id: action.id,
      label: action.label,
      to: action.to,
      reason: action.reason,
      primary: index === 0,
      disabled: action.disabled === true,
      disabledReason: action.disabledReason ?? null,
    })),
    otherIssues: input.otherIssues.map((issue) => ({
      code: issue.code,
      chip: reasonChip(issue.code),
      explanation: issue.detail.line ? String(issue.detail.line) : explainReason(issue.code, issue.detail),
    })),
    trail: (input.trail ?? []).map((entry) => ({
      label: entry.status === "PROCESSING" ? "Processing" : `${ORDER_STATUS_INFO[entry.status].label}${entry.reason ? ` · ${reasonChip(entry.reason)}` : ""}`,
      steps: (entry.steps ?? []).map((step) => stepProgress(step, entry.detail ?? {})),
    })),
    scanAtRisk: input.scanAtRisk === true,
  };
}

const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s+\d{4})?)\b/gi;
const NUMBER_PATTERN = /\d[\d,]*/g;

/**
 * An LLM may rephrase the template. Every number and date in that sentence must already be in `detail`.
 * Anything else is dropped and the template is used.
 */
export function guardSummary(rewritten: string, detail: ReasonDetail, template: string): string {
  const haystack = detailHaystack(detail);
  const facts = [...(rewritten.match(DATE_PATTERN) ?? []), ...(rewritten.match(NUMBER_PATTERN) ?? [])];
  const stray = facts.some((fact) => !haystack.includes(fact.replace(/,/g, "").toLowerCase()) && !haystack.includes(fact.toLowerCase()));
  return stray ? template : rewritten;
}

function detailHaystack(detail: ReasonDetail): string {
  return Object.values(detail)
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
}

export function unfilledPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{[a-zA-Z]+\}/g)].map((match) => match[0]);
}

export function deadlineLine(scanLabel: string | null, fixByLabel: string | null): string | null {
  if (!scanLabel && !fixByLabel) return null;
  if (scanLabel && fixByLabel) return `Scan ${scanLabel} · fix by ${fixByLabel}`;
  return scanLabel ? `Scan ${scanLabel}` : `Fix by ${fixByLabel}`;
}

export function compactTrail(steps: SummaryTrailStep[], expanded: boolean): string {
  if (expanded) {
    return steps
      .map((step) => (step.steps.length > 0 ? `${step.label} (${step.steps.join(", ")})` : step.label))
      .join(" → ");
  }
  return steps.map((step) => step.label).join(" → ");
}

export function filledTemplate(code: ReasonCode, detail: ReasonDetail): string {
  return explainReason(code, detail);
}

export function templateHasHoles(template: string, detail: ReasonDetail): boolean {
  return unfilledPlaceholders(fill(template, detail)).length > 0;
}

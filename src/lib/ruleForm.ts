// Pure helpers behind the rule editor: option lists, how new criteria, waivers and properties are made, and how
// validation issues find their field. No React here, so it is unit-tested directly.

import { slugify } from "@/domain/rules/common";
import { FACT_KINDS } from "@/domain/rules/facts";
import { POLICY_PROPERTY } from "@/domain/rules/policyProperties";
import { CHECK_OPS, SOURCE_TYPES, type CheckOp, type Criterion, type PolicyException, type Property, type PropertyValue, type ValidationIssue } from "@/domain/rules/types";
import { ACCEPTED_SOURCE_LABEL, BODY_SITE_LABEL, CHECK_OP_LABEL, FACT_KIND_LABEL } from "./labels";

export type Option = { id: string; label: string };

const opts = (ids: readonly string[], labels: Record<string, string>): Option[] => ids.map((id) => ({ id, label: labels[id] ?? id }));

export const SOURCE_OPTIONS = opts(SOURCE_TYPES, ACCEPTED_SOURCE_LABEL);
export const BODY_SITE_OPTIONS = opts(Object.keys(BODY_SITE_LABEL), BODY_SITE_LABEL);
export const CHECK_OPTIONS = opts(CHECK_OPS, CHECK_OP_LABEL);
export const FACT_OPTIONS = opts(
  FACT_KINDS.map((k) => k.id),
  FACT_KIND_LABEL,
);

export const CHANNEL_OPTIONS: Option[] = [
  { id: "api", label: "API" },
  { id: "portal", label: "Portal" },
  { id: "fax", label: "Fax" },
];

export const INCOMPLETE_OPTIONS: Option[] = [
  { id: "amendable", label: "Can be amended after submission" },
  { id: "deny_resubmit_new", label: "Denied; must resubmit as new" },
];

export const PLAN_OPTIONS: Option[] = [
  { id: "commercial_hmo", label: "Commercial HMO" },
  { id: "commercial_ppo", label: "Commercial PPO" },
  { id: "commercial_epo", label: "Commercial EPO" },
  { id: "medicare_advantage", label: "Medicare Advantage" },
  { id: "medicaid_managed_care", label: "Medicaid" },
];

/* ------------------------------- properties ------------------------------- */

export type ValueType = "number" | "text" | "boolean" | "list";

export const VALUE_TYPE_OPTIONS: Array<{ id: ValueType; label: string }> = [
  { id: "number", label: "Number" },
  { id: "text", label: "Text" },
  { id: "boolean", label: "Yes / No" },
  { id: "list", label: "List" },
];

export function valueTypeOf(p: Pick<Property, "value">): ValueType {
  if (typeof p.value === "number") return "number";
  if (typeof p.value === "boolean") return "boolean";
  if (Array.isArray(p.value)) return "list";
  return "text";
}

export function defaultValue(type: ValueType): PropertyValue {
  return type === "number" ? 1 : type === "boolean" ? true : type === "list" ? [] : "";
}

/** The value a check needs. Null means any value works (present / absent read the value as a description). */
const OP_VALUE: Record<CheckOp, ValueType | null> = {
  min_weeks: "number",
  within_months: "number",
  source_in: "list",
  source_not_in: "list",
  same_side: "boolean",
  present: null,
  absent: null,
};

const OP_UNIT: Partial<Record<CheckOp, string>> = { min_weeks: "weeks", within_months: "months" };

/** A sensible first fact for each check; the user can change it. */
const OP_FACT: Record<CheckOp, string> = {
  min_weeks: "symptom_onset",
  within_months: "conservative_treatment",
  source_in: "conservative_treatment",
  source_not_in: "conservative_treatment",
  same_side: "mri",
  present: "xray",
  absent: "mri",
};

/** Set, change or (with null) remove a property's check, reshaping the value only when the check needs it. */
export function applyCheck(p: Property, op: CheckOp | null, fact?: string): Property {
  if (!op) {
    const { check: _check, ...rest } = p;
    return rest;
  }
  const want = OP_VALUE[op];
  const value = want && valueTypeOf(p) !== want ? defaultValue(want) : p.value;
  const unit = OP_UNIT[op] ?? (want === "number" ? p.unit : want ? undefined : p.unit);
  const next: Property = { ...p, value, check: { op, fact: fact ?? p.check?.fact ?? OP_FACT[op] } };
  if (unit) next.unit = unit;
  else delete next.unit;
  return next;
}

/** A unique key from the label: "Lookback" -> "lookback", then "lookback_2". */
export function propertyKey(label: string, existing: Property[]): string {
  const base = slugify(label) || "property";
  const taken = new Set(existing.map((p) => p.key));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export interface NewProperty {
  label: string;
  valueType: ValueType;
  op: CheckOp | null;
  fact: string | null;
}

export function newProperty(spec: NewProperty, existing: Property[]): Property {
  const label = spec.label.trim();
  const base: Property = { key: propertyKey(label, existing), label, value: defaultValue(spec.valueType) };
  return spec.op ? applyCheck(base, spec.op, spec.fact ?? undefined) : base;
}

/** Policy properties the app acts on. Offered as one-click adds; anything else is free-form. */
export const KNOWN_POLICY_PROPERTIES: Property[] = [
  { key: POLICY_PROPERTY.planTypes, label: "Plans", value: [] },
  { key: POLICY_PROPERTY.channels, label: "Submit via", value: [] },
  { key: POLICY_PROPERTY.attachments, label: "Attach", value: [] },
  { key: POLICY_PROPERTY.incompleteRequests, label: "Incomplete requests", value: "deny_resubmit_new" },
];

/** Which choices a list property offers, if it is one of the known kinds. */
export function listOptionsFor(p: Pick<Property, "key" | "check">): Option[] | null {
  if (p.check?.op === "source_in" || p.check?.op === "source_not_in") return SOURCE_OPTIONS;
  if (p.key === POLICY_PROPERTY.planTypes) return PLAN_OPTIONS;
  if (p.key === POLICY_PROPERTY.channels) return CHANNEL_OPTIONS;
  return null;
}

/* ------------------------------- new rows ------------------------------- */

function freeKey(prefix: string, taken: string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

export function newCriterion(versionId: string, existing: Criterion[], localId: () => string): Criterion {
  return {
    id: localId(),
    policyVersionId: versionId,
    key: freeKey("criterion", existing.map((c) => c.key)),
    ref: "",
    displayLabel: "",
    properties: [],
    evaluationMode: "auto",
    failureType: "fixable",
    excerpt: "",
    sortOrder: existing.length,
  };
}

export function newWaiver(versionId: string, existing: PolicyException[], localId: () => string): PolicyException {
  return {
    id: localId(),
    policyVersionId: versionId,
    key: freeKey("waiver", existing.map((e) => e.key)),
    ref: "",
    displayLabel: "",
    triggers: [],
    waivesCriterionKeys: [],
    evaluationMode: "human_review",
    excerpt: "",
    assumption: null,
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Trigger chips are stored as slugs and shown as sentences. */
export function triggerFromText(raw: string): string {
  return slugify(raw);
}

/* ------------------------------- validation → fields ------------------------------- */

/** Issues whose path is this prefix or sits below it ("criteria.x" matches "criteria.x.properties.duration"). */
export function issuesAt(issues: ValidationIssue[], prefix: string, opts: { exact?: boolean } = {}): ValidationIssue[] {
  return issues.filter((i) => (opts.exact ? i.path === prefix : i.path === prefix || i.path.startsWith(`${prefix}.`)));
}

export const criterionPath = (c: Pick<Criterion, "key" | "id">) => `criteria.${c.key || c.id}`;
export const waiverPath = (e: Pick<PolicyException, "key" | "id">) => `exceptions.${e.key || e.id}`;
export const propertyPath = (base: string, p: Pick<Property, "key">) => `${base}.properties.${p.key || "(new)"}`;

/** One short line for the header: "2 errors block publishing" or "" when clean. */
export function issueSummary(errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? "error blocks" : "errors block"} publishing`);
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(" · ");
}

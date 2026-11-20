// View model for the Rule library card. Everything the card shows is derived from a stored PolicyVersion,
// so editing the data changes the screen. No rule content lives in components, and every insurer renders the
// same way: header, policy properties, criteria, exceptions.

import { POLICY_PROPERTY, assumptionCount } from "@/domain/rules/policyProperties";
import type { PolicyVersion, Property } from "@/domain/rules/types";
import {
  ACCEPTED_SOURCE_LABEL,
  CHANNEL_LABEL,
  FAILURE_TYPE_LABEL,
  INCOMPLETE_HANDLING_LABEL,
  PLAN_TYPE_LABEL,
  VERSION_STATUS_LABEL,
  humanizeKey,
  label,
} from "./labels";

export interface PropertyRow {
  key: string;
  label: string;
  value: string;
  assumption: string | null;
  checked: boolean;
}

export interface CriterionCard {
  key: string;
  /** The insurer's own reference, exactly as stored. */
  ref: string;
  label: string;
  failure: string;
  properties: PropertyRow[];
  excerpt: string;
  hasAssumption: boolean;
}

export interface ExceptionCard {
  key: string;
  ref: string;
  label: string;
  /** "Waives 2a, 2b, 2c" */
  waives: string;
  properties: PropertyRow[];
  excerpt: string;
  assumption: string | null;
}

export interface RuleCard {
  policyProperties: PropertyRow[];
  criteria: CriterionCard[];
  exceptions: ExceptionCard[];
  assumptionCount: number;
}

const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)+$/;
const shown = (s: string) => (SNAKE.test(s) ? humanizeKey(s) : s);

/** "6 weeks", "PT notes, Clinic notes", "Portal or API", "Yes". */
export function formatPropertyValue(p: Pick<Property, "key" | "value" | "unit" | "check">): string {
  const { value } = p;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!p.unit) return String(value);
    return `${value} ${value === 1 ? p.unit.replace(/s$/, "") : p.unit}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (p.check?.op === "source_in" || p.check?.op === "source_not_in") return value.map((s) => label(ACCEPTED_SOURCE_LABEL, s)).join(", ");
    if (p.key === POLICY_PROPERTY.planTypes) return value.map((s) => label(PLAN_TYPE_LABEL, s)).join(", ");
    if (p.key === POLICY_PROPERTY.channels) return value.map((s) => label(CHANNEL_LABEL, s)).join(" or ");
    return value.map(shown).join(", ");
  }
  if (p.key === POLICY_PROPERTY.incompleteRequests) return label(INCOMPLETE_HANDLING_LABEL, value);
  return shown(value);
}

export function propertyRow(p: Property): PropertyRow {
  return { key: p.key, label: p.label, value: formatPropertyValue(p), assumption: p.assumption?.trim() || null, checked: !!p.check };
}

export function buildRuleCard(v: PolicyVersion): RuleCard {
  const sorted = [...v.criteria].sort((a, b) => a.sortOrder - b.sortOrder);
  const refOf = (key: string) => sorted.find((c) => c.key === key)?.ref || key;

  return {
    policyProperties: v.properties.map(propertyRow),
    criteria: sorted.map((c) => ({
      key: c.key,
      ref: c.ref,
      label: c.displayLabel,
      failure: label(FAILURE_TYPE_LABEL, c.failureType),
      properties: c.properties.map(propertyRow),
      excerpt: c.excerpt,
      hasAssumption: c.properties.some((p) => !!p.assumption),
    })),
    exceptions: v.exceptions.map((e) => ({
      key: e.key,
      ref: e.ref,
      label: e.displayLabel,
      waives: `Waives ${e.waivesCriterionKeys.map(refOf).join(", ") || "nothing"}`,
      properties: [
        { key: "triggers", label: "When", value: e.triggers.map(humanizeKey).join(", "), assumption: null, checked: true },
        ...(e.evaluationMode === "human_review" ? [{ key: "review", label: "Review", value: "A clinician confirms", assumption: null, checked: false }] : []),
      ],
      excerpt: e.excerpt,
      assumption: e.assumption?.trim() || null,
    })),
    assumptionCount: assumptionCount(v),
  };
}

const dateLong = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export const fmtLongDate = (iso: string) => dateLong.format(new Date(`${iso}T12:00:00`));

/** "v3 · Active since Jan 1, 2026" */
export function versionBadge(v: { versionNumber: number; derivedStatus: string; effectiveFrom: string | null } | null): string {
  if (!v) return "No version";
  const n = `v${v.versionNumber}`;
  const from = v.effectiveFrom ? fmtLongDate(v.effectiveFrom) : null;
  switch (v.derivedStatus) {
    case "active":
      return from ? `${n} · Active since ${from}` : `${n} · Active`;
    case "scheduled":
      return `${n} · Starts ${from}`;
    case "draft":
      return `Draft ${n}`;
    default:
      return `${n} · ${humanizeKey(v.derivedStatus)}`;
  }
}

interface VersionLike {
  versionNumber: number;
  derivedStatus: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** "Mar 1" within the current year, "Mar 1, 2027" otherwise. */
export function fmtShortDate(iso: string, today: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "v4 takes effect Mar 1 · 2 changes". The banner on the active card when something is scheduled. */
export function scheduledBanner(next: { versionNumber: number; effectiveFrom: string | null }, changes: number, today: string): string {
  const when = next.effectiveFrom ? ` takes effect ${fmtShortDate(next.effectiveFrom, today)}` : " is scheduled";
  return `v${next.versionNumber}${when} · ${changes} ${changes === 1 ? "change" : "changes"}`;
}

const isoDay = (iso: string) => iso.slice(0, 10);

/** "Jan 1, 2026 →" for an open range, "Jan 1, 2025 – Jun 30, 2025" for a closed one. */
export function rangeLabel(v: Pick<VersionLike, "effectiveFrom" | "effectiveTo">): string {
  if (!v.effectiveFrom) return "No date yet";
  const from = fmtLongDate(v.effectiveFrom);
  return v.effectiveTo ? `${from} – ${fmtLongDate(v.effectiveTo)}` : `${from} →`;
}

/** When a superseded version stopped governing: the day its successor took over. */
export function supersededOn(v: VersionLike, all: VersionLike[]): string | null {
  if (!v.effectiveFrom) return null;
  const next = all
    .filter((x) => (x.derivedStatus === "active" || x.derivedStatus === "superseded" || x.derivedStatus === "scheduled") && x.effectiveFrom && x.effectiveFrom > v.effectiveFrom!)
    .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))[0];
  if (next) return next.effectiveFrom;
  return v.effectiveTo ? isoDay(addOneDay(v.effectiveTo)) : null;
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Banner for any version that is not the one governing today. Null for the active version. */
export function versionBanner(v: VersionLike, all: VersionLike[]): string | null {
  const n = `v${v.versionNumber}`;
  switch (v.derivedStatus) {
    case "active":
      return null;
    case "superseded": {
      const on = supersededOn(v, all);
      return `You're viewing ${n} (superseded${on ? ` ${fmtLongDate(on)}` : ""}).`;
    }
    case "scheduled":
      return `You're viewing ${n} (scheduled${v.effectiveFrom ? `, starts ${fmtLongDate(v.effectiveFrom)}` : ""}).`;
    default:
      return `You're viewing ${n} (${label(VERSION_STATUS_LABEL, v.derivedStatus).toLowerCase()}).`;
  }
}

/** "Published by Priya Raman · Dec 18, 2025", or who is drafting it. */
export function publishedLine(v: { status: string; publishedBy: string | null; publishedAt: string | null; lastEditedBy: string; updatedAt: string }): string {
  if (v.status === "published" && v.publishedBy && v.publishedAt) return `Published by ${v.publishedBy} · ${fmtLongDate(isoDay(v.publishedAt))}`;
  return `${v.status === "archived" ? "Archived" : "Edited"} by ${v.lastEditedBy} · ${fmtLongDate(isoDay(v.updatedAt))}`;
}

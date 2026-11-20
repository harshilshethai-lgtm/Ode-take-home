// Validation for a policy version. Run on every save (never rejects a draft, so autosave works on half-finished
// work) and again, stricter, on publish.

import { describeCriterion, planTypeLabel } from "./describe";
import { isISODate, rangesOverlap } from "./dates";
import { getFactKind } from "./facts";
import { POLICY_PROPERTY, incompleteHandlingOf } from "./policyProperties";
import { CHECK_OPS } from "./types";
import type { Payer, Policy, PolicyVersion, Property, ValidationIssue, ValidationResult } from "./types";
import { deriveStatus, sharedClaims } from "./versionStatus";

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const CPT_PATTERN = /^[0-9]{4}[0-9A-Z]$/;
export const MIN_TEST_CASES = 3;

export interface ValidationContext {
  policy: Policy;
  payers: Payer[];
  /** Every version of every policy, so cross-policy conflicts can be found. */
  allVersions: PolicyVersion[];
  policies: Policy[];
  testCaseCount: number;
  today: string;
}

export interface PublishRequest {
  effectiveFrom: string | null;
  changeNote: string | null;
}

function hasText(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

const NUMBER_OPS = new Set(["min_weeks", "within_months"]);
const LIST_OPS = new Set(["source_in", "source_not_in"]);

/** Property shape and check problems, reported against `${at}.properties.<key>`. */
function checkProperties(
  props: Property[],
  at: string,
  name: string,
  err: (code: string, path: string, message: string) => void,
  warn: (code: string, path: string, message: string) => void,
) {
  const seen = new Set<string>();
  for (const p of props) {
    const path = `${at}.properties.${p.key || "(new)"}`;
    const label = p.label || p.key || "A property";
    if (!hasText(p.label)) err("property.label.missing", `${path}.label`, `${name}: a property needs a label.`);
    if (!KEY_PATTERN.test(p.key)) err("property.key.invalid", `${path}.key`, `${name}: ${label} needs a key like "duration".`);
    else if (seen.has(p.key)) err("property.key.duplicate", `${path}.key`, `${name}: two properties are called "${label}".`);
    seen.add(p.key);
    if (p.value === "" || (Array.isArray(p.value) && p.value.length === 0)) {
      err("property.value.missing", `${path}.value`, `${name}: ${label} needs a value.`);
    }
    if (p.assumption !== undefined && !hasText(p.assumption)) {
      err("property.assumption.note", `${path}.assumption`, `${name}: explain what ${label} assumes.`);
    } else if (hasText(p.assumption)) {
      warn("assumption", path, `${name}: ${label} is an assumption (${p.assumption}). Confirm with the payer.`);
    }
    if (!p.check) continue;
    const { op, fact } = p.check;
    if (!(CHECK_OPS as readonly string[]).includes(op)) err("property.check.op", `${path}.check`, `${name}: ${label} has an unknown check "${op}".`);
    if (!getFactKind(fact)) err("property.check.fact", `${path}.check`, `${name}: ${label} checks "${fact || "nothing"}"; pick what it checks.`);
    if (NUMBER_OPS.has(op) && !(typeof p.value === "number" && p.value > 0)) {
      err("property.value.number", `${path}.value`, `${name}: ${label} needs a number above zero for this check.`);
    }
    if (LIST_OPS.has(op) && !Array.isArray(p.value)) err("property.value.list", `${path}.value`, `${name}: ${label} needs a list of sources.`);
    if (op === "min_weeks" && getFactKind(fact) && !getFactKind(fact)!.duration) {
      err("property.check.weeks", `${path}.check`, `${name}: weeks cannot be measured for this fact.`);
    }
  }
}

export function validateVersion(version: PolicyVersion, ctx: ValidationContext, publish?: PublishRequest): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (code: string, path: string, message: string, criterionKey?: string) => errors.push({ code, path, message, criterionKey });
  const warn = (code: string, path: string, message: string, criterionKey?: string) => warnings.push({ code, path, message, criterionKey });

  /* ---- criteria ---- */
  if (version.criteria.length === 0) err("criteria.empty", "criteria", "Add at least one criterion.");
  const keys = new Set<string>();
  for (const c of version.criteria) {
    const at = `criteria.${c.key || c.id}`;
    const name = c.displayLabel || c.key || "Untitled criterion";
    if (!KEY_PATTERN.test(c.key)) {
      err("criterion.key.invalid", `${at}.key`, `${name}: key must be a lowercase slug such as "symptom_duration".`, c.key);
    } else if (keys.has(c.key)) {
      err("criterion.key.duplicate", `${at}.key`, `${name}: key "${c.key}" is used more than once in this version.`, c.key);
    }
    keys.add(c.key);
    if (!hasText(c.displayLabel)) err("criterion.label.missing", `${at}.displayLabel`, `Criterion "${c.key}" needs a label.`, c.key);

    if (!hasText(c.ref)) err("criterion.ref.missing", `${at}.ref`, `${name}: add the insurer's own reference, e.g. "2b" or "(2)".`, c.key);
    if (!hasText(c.excerpt)) err("criterion.excerpt.missing", `${at}.excerpt`, `${name}: paste the verbatim insurer text this criterion encodes.`, c.key);
    const accepted = c.properties.filter((p) => p.check?.op === "source_in").flatMap((p) => (Array.isArray(p.value) ? p.value : []));
    const excluded = c.properties.filter((p) => p.check?.op === "source_not_in").flatMap((p) => (Array.isArray(p.value) ? p.value : []));
    if (accepted.some((x) => excluded.includes(x))) {
      err("criterion.sources.overlap", `${at}.properties`, `${name}: a source cannot be both accepted and excluded.`, c.key);
    }
    checkProperties(c.properties, at, name, (code, path, m) => err(code, path, m, c.key), (code, path, m) => warn(code, path, m, c.key));
  }

  /* ---- exceptions ---- */
  const exKeys = new Set<string>();
  for (const e of version.exceptions) {
    const at = `exceptions.${e.key || e.id}`;
    const name = e.displayLabel || e.key || "Untitled exception";
    if (!KEY_PATTERN.test(e.key)) err("exception.key.invalid", `${at}.key`, `${name}: key must be a lowercase slug.`);
    else if (exKeys.has(e.key)) err("exception.key.duplicate", `${at}.key`, `${name}: key "${e.key}" is used more than once.`);
    exKeys.add(e.key);
    if (!hasText(e.displayLabel)) err("exception.label.missing", `${at}.displayLabel`, `Exception "${e.key}" needs a label.`);
    if (e.triggers.length === 0) err("exception.triggers.empty", `${at}.triggers`, `${name}: add at least one trigger.`);
    if (e.waivesCriterionKeys.length === 0) err("exception.waives.empty", `${at}.waivesCriterionKeys`, `${name}: choose which criteria it waives (there is no "waive everything").`);
    for (const k of e.waivesCriterionKeys) {
      if (!keys.has(k)) err("exception.waives.unknown", `${at}.waivesCriterionKeys`, `${name}: waives "${k}", which is not a criterion in this version.`);
    }
    if (!hasText(e.ref)) err("exception.ref.missing", `${at}.ref`, `${name}: add the insurer's own reference.`);
    if (!hasText(e.excerpt)) err("exception.excerpt.missing", `${at}.excerpt`, `${name}: paste the verbatim insurer text.`);
    if (e.assumption !== null) {
      if (hasText(e.assumption)) warn("assumption", at, `${name}: encodes an assumption (${e.assumption}). Confirm with the payer.`);
      else err("exception.assumption.note", `${at}.assumption`, `${name}: explain what is assumed.`);
    }
  }

  /* ---- applicability ---- */
  const app = version.applicability;
  if (app.cptCodes.length === 0) err("applicability.cpt.empty", "applicability.cptCodes", "Add at least one CPT code.");
  for (const code of app.cptCodes) {
    if (!CPT_PATTERN.test(code)) err("applicability.cpt.invalid", "applicability.cptCodes", `"${code}" is not a valid CPT code (5 characters).`);
  }
  if (new Set(app.cptCodes).size !== app.cptCodes.length) err("applicability.cpt.duplicate", "applicability.cptCodes", "A CPT code is listed twice.");
  checkProperties(version.properties, "policy", "Policy", err, warn);
  if (app.settings !== "all" && app.settings.length === 0) err("applicability.settings.empty", "applicability.settings", 'Choose "all settings" or pick at least one.');

  /* ---- publish-only checks ---- */
  const effectiveFrom = publish ? publish.effectiveFrom : version.effectiveFrom;
  if (publish) {
    if (!publish.effectiveFrom) err("publish.effective.missing", "effectiveFrom", "Choose an effective-from date.");
    else if (!isISODate(publish.effectiveFrom)) err("publish.effective.invalid", "effectiveFrom", "Effective-from must be a valid date.");
    if (!hasText(publish.changeNote)) err("publish.changeNote.missing", "changeNote", "Write a change note describing what changed and why.");
  }

  const dateOk = !!effectiveFrom && isISODate(effectiveFrom);
  const others = ctx.allVersions.filter((v) => v.id !== version.id && v.status === "published");

  // Same-policy timeline: a new version supersedes the latest one, and may not slot in before or beside it.
  if (publish && dateOk) {
    const mine = others.filter((v) => v.policyId === version.policyId && v.effectiveFrom);
    const latest = [...mine].sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!))[0];
    if (latest && effectiveFrom! <= latest.effectiveFrom!) {
      const st = deriveStatus(latest, ctx.today);
      err(
        "publish.effective.overlap",
        "effectiveFrom",
        `Effective date ${effectiveFrom} would overlap v${latest.versionNumber}, which is ${st} from ${latest.effectiveFrom}. A new version must take effect after ${latest.effectiveFrom} so it supersedes v${latest.versionNumber}.`,
      );
    }
    if (effectiveFrom! < ctx.today) warn("publish.effective.past", "effectiveFrom", `Effective date ${effectiveFrom} is in the past. Past evaluations keep their pinned version; new evaluations dated from then on will use this one.`);
  }

  // Cross-policy conflicts: same payer, same CPT + plan type, overlapping dates.
  const windowFrom = dateOk ? effectiveFrom! : ctx.today;
  const nameOf = (p: Policy) => `${ctx.payers.find((x) => x.id === p.payerId)?.name ?? ""} ${p.externalPolicyId}`.trim();
  for (const o of others) {
    if (o.policyId === version.policyId) continue;
    const otherPolicy = ctx.policies.find((p) => p.id === o.policyId);
    if (!otherPolicy || otherPolicy.payerId !== ctx.policy.payerId || !o.effectiveFrom) continue;
    const shared = sharedClaims(version, o);
    if (!shared) continue;
    if (!rangesOverlap(windowFrom, null, o.effectiveFrom, o.effectiveTo)) continue;
    const plans = shared.planTypes === "all" ? "all plan types" : shared.planTypes.map(planTypeLabel).join(", ");
    err(
      "applicability.conflict",
      "applicability",
      `Conflict: ${nameOf(ctx.policy)} and ${nameOf(otherPolicy)} (v${o.versionNumber}, effective ${o.effectiveFrom}${o.effectiveTo ? ` to ${o.effectiveTo}` : " onward"}) both claim CPT ${shared.cptCodes.join(", ")} for ${plans}.`,
    );
  }

  /* ---- warnings ---- */
  if (ctx.testCaseCount < MIN_TEST_CASES) {
    warn("tests.few", "testCases", `This policy has ${ctx.testCaseCount} test case${ctx.testCaseCount === 1 ? "" : "s"}; add at least ${MIN_TEST_CASES} so changes can be checked.`);
  }
  if (incompleteHandlingOf(version) === "unspecified") {
    warn("policy.incomplete.unspecified", `policy.properties.${POLICY_PROPERTY.incompleteRequests}`, "The policy does not say whether incomplete requests can be amended. Confirm with the payer.");
  }

  return { errors, warnings };
}

/** For UI: the plain-English text of a criterion even while it is half-edited. */
export { describeCriterion };

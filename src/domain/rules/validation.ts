// Validation for a policy version. Run on every save (never rejects a draft, so autosave works on half-finished
// work) and again, stricter, on publish.

import { describeCriterion } from "./describe";
import { isISODate, rangesOverlap } from "./dates";
import { getPrimitive } from "./primitives/registry";
import { planTypeLabel } from "./describe";
import type { Payer, Policy, PolicyVersion, ValidationIssue, ValidationResult } from "./types";
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

    const prim = getPrimitive(c.type);
    if (!prim) {
      err("criterion.type.invalid", `${at}.type`, `${name}: "${c.type}" is not a known rule type.`, c.key);
    } else {
      const parsed = prim.paramsSchema.safeParse(c.params);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path.join(".") || "(params)";
          err("criterion.params.invalid", `${at}.params.${field}`, `${name}: ${field} ${issue.message.toLowerCase()}`, c.key);
        }
      }
    }
    if (!hasText(c.sourceCitation?.section) || !hasText(c.sourceCitation?.excerpt)) {
      err("criterion.citation.missing", `${at}.sourceCitation`, `${name}: add the insurer's section label and the verbatim excerpt this rule encodes.`, c.key);
    }
    if (c.isAssumption) {
      warn("assumption", at, `${name}: encodes an assumption${hasText(c.interpretationNote) ? ` (${c.interpretationNote})` : ""}. Confirm with the payer.`, c.key);
      if (!hasText(c.interpretationNote)) {
        err("criterion.assumption.note", `${at}.interpretationNote`, `${name}: explain the assumption in the interpretation note.`, c.key);
      }
    }
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
    if (!hasText(e.sourceCitation?.section) || !hasText(e.sourceCitation?.excerpt)) {
      err("exception.citation.missing", `${at}.sourceCitation`, `${name}: add the insurer's section label and verbatim excerpt.`);
    }
    if (e.isAssumption) {
      warn("assumption", at, `${name}: encodes an assumption${hasText(e.interpretationNote) ? ` (${e.interpretationNote})` : ""}. Confirm with the payer.`);
      if (!hasText(e.interpretationNote)) err("exception.assumption.note", `${at}.interpretationNote`, `${name}: explain the assumption in the interpretation note.`);
    }
  }

  /* ---- applicability ---- */
  const app = version.applicability;
  if (app.cptCodes.length === 0) err("applicability.cpt.empty", "applicability.cptCodes", "Add at least one CPT code.");
  for (const code of app.cptCodes) {
    if (!CPT_PATTERN.test(code)) err("applicability.cpt.invalid", "applicability.cptCodes", `"${code}" is not a valid CPT code (5 characters).`);
  }
  if (new Set(app.cptCodes).size !== app.cptCodes.length) err("applicability.cpt.duplicate", "applicability.cptCodes", "A CPT code is listed twice.");
  if (app.planTypes !== "all" && app.planTypes.length === 0) err("applicability.plans.empty", "applicability.planTypes", 'Choose "all plans" or list at least one plan type.');
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
    const shared = sharedClaims(app, o.applicability);
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
  if (version.submission.incompleteRequestHandling === "unspecified") {
    warn("submission.incomplete.unspecified", "submission.incompleteRequestHandling", "The policy does not say whether incomplete requests can be amended. Confirm with the payer.");
  }

  return { errors, warnings };
}

/** For UI: the plain-English text of a criterion even while it is half-edited. */
export { describeCriterion };

import type { EvaluationInput, NoPolicyReason, Payer, Policy, PolicyVersion } from "./types";
import { cptMatches, isEffectiveOn, planMatches, settingMatches } from "./versionStatus";
import { describeApplicability, planTypeLabel } from "./describe";

export interface Catalog {
  payers: Payer[];
  policies: Policy[];
  versions: PolicyVersion[];
}

export type ResolveResult =
  | { found: true; payer: Payer; policy: Policy; version: PolicyVersion }
  | { found: false; reason: NoPolicyReason; message: string };

type Query = Pick<EvaluationInput, "payerId" | "planType" | "cptCode" | "serviceDate" | "setting">;

/**
 * Pick the published version whose applicability matches the order and whose effective window contains the
 * service date. Purely data-driven: nothing here knows any payer by name.
 */
export function resolvePolicyVersion(cat: Catalog, q: Query): ResolveResult {
  const payer = cat.payers.find((p) => p.id === q.payerId);
  const payerName = payer?.name ?? q.payerId;
  const policyIds = new Set(cat.policies.filter((p) => p.payerId === q.payerId).map((p) => p.id));
  const published = cat.versions.filter((v) => v.status === "published" && policyIds.has(v.policyId));
  const policyOf = (v: PolicyVersion) => cat.policies.find((p) => p.id === v.policyId)!;

  const byCpt = published.filter((v) => cptMatches(v.applicability, q.cptCode));
  if (byCpt.length === 0) {
    return { found: false, reason: "no_policy_for_cpt", message: `No ${payerName} policy covers CPT ${q.cptCode}.` };
  }

  const byPlan = byCpt.filter((v) => planMatches(v.applicability, q.planType));
  if (byPlan.length === 0) {
    const v = byCpt[0];
    return {
      found: false,
      reason: "plan_type_excluded",
      message: `${payerName} ${policyOf(v).externalPolicyId} covers CPT ${q.cptCode} but excludes plan type "${planTypeLabel(q.planType)}" (${describeApplicability(v.applicability)}).`,
    };
  }

  const bySetting = byPlan.filter((v) => settingMatches(v.applicability, q.setting));
  if (bySetting.length === 0) {
    const v = byPlan[0];
    return {
      found: false,
      reason: "setting_excluded",
      message: `${payerName} ${policyOf(v).externalPolicyId} does not apply to ${q.setting} requests.`,
    };
  }

  const effective = bySetting.filter((v) => isEffectiveOn(v, q.serviceDate));
  if (effective.length === 0) {
    const v = bySetting[0];
    const earliest = bySetting.map((x) => x.effectiveFrom!).sort()[0];
    return {
      found: false,
      reason: "no_version_effective",
      message: `${payerName} ${policyOf(v).externalPolicyId} has no version effective on ${q.serviceDate} (earliest effective date is ${earliest}).`,
    };
  }

  // Conflict validation should make this a single match; if not, prefer the most recently effective, deterministically.
  const version = [...effective].sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!) || b.versionNumber - a.versionNumber)[0];
  return { found: true, payer: payer!, policy: policyOf(version), version };
}

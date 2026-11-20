import { rangesOverlap } from "./dates";
import { planTypesOf } from "./policyProperties";
import type { Applicability, PolicyVersion, Setting, VersionStatus } from "./types";

type Scope = Pick<PolicyVersion, "applicability" | "properties">;

/**
 * Only draft / published / archived are stored. The rest is computed from the effective dates, so a version
 * "becomes" active or superseded just by the calendar moving, with no job needing to run.
 */
export function deriveStatus(v: Pick<PolicyVersion, "status" | "effectiveFrom" | "effectiveTo">, today: string): VersionStatus {
  if (v.status === "draft") return "draft";
  if (v.status === "archived") return "archived";
  if (!v.effectiveFrom || v.effectiveFrom > today) return "scheduled";
  if (v.effectiveTo !== null && v.effectiveTo < today) return "superseded";
  return "active";
}

export function isEffectiveOn(v: Pick<PolicyVersion, "status" | "effectiveFrom" | "effectiveTo">, date: string): boolean {
  return (
    v.status === "published" && !!v.effectiveFrom && v.effectiveFrom <= date && (v.effectiveTo === null || v.effectiveTo >= date)
  );
}

/**
 * The published version of a policy whose date range contains `date` (both ends inclusive), or null.
 * Drafts and archived versions never govern. If data ever overlaps, the later-starting version wins.
 */
export function versionFor<T extends Pick<PolicyVersion, "policyId" | "status" | "effectiveFrom" | "effectiveTo" | "versionNumber">>(
  versions: T[],
  policyId: string,
  date: string,
): T | null {
  const hits = versions.filter((v) => v.policyId === policyId && isEffectiveOn(v, date));
  hits.sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!) || b.versionNumber - a.versionNumber);
  return hits[0] ?? null;
}

export interface OrderShape {
  cptCode: string;
  planType: string;
  setting?: Setting;
}

export function cptMatches(a: Applicability, cptCode: string): boolean {
  return a.cptCodes.includes(cptCode);
}
/** Plan types live in the version's properties; a policy that states none applies to every plan. */
export function planMatches(v: Scope, planType: string): boolean {
  const plans = planTypesOf(v);
  return plans === "all" || plans.includes(planType);
}
export function settingMatches(a: Applicability, setting?: Setting): boolean {
  return a.settings === "all" || setting === undefined || a.settings.includes(setting);
}

export function applicabilityMatches(v: Scope, o: OrderShape): boolean {
  return cptMatches(v.applicability, o.cptCode) && planMatches(v, o.planType) && settingMatches(v.applicability, o.setting);
}

/** CPT codes + plan types + settings both claim. Used for cross-policy conflict detection. */
export function sharedClaims(x: Scope, y: Scope): { cptCodes: string[]; planTypes: string[] | "all" } | null {
  const a = x.applicability;
  const b = y.applicability;
  const cpts = a.cptCodes.filter((c) => b.cptCodes.includes(c));
  if (cpts.length === 0) return null;
  const pa = planTypesOf(x);
  const pb = planTypesOf(y);
  let plans: string[] | "all";
  if (pa === "all") plans = pb;
  else if (pb === "all") plans = pa;
  else plans = pa.filter((p) => pb.includes(p));
  if (plans !== "all" && plans.length === 0) return null;
  const settingsOverlap =
    a.settings === "all" || b.settings === "all" || a.settings.some((s) => (b.settings as Setting[]).includes(s));
  if (!settingsOverlap) return null;
  return { cptCodes: cpts, planTypes: plans };
}

export { rangesOverlap };

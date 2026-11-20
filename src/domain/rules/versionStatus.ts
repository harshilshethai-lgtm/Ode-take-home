import { rangesOverlap } from "./dates";
import type { Applicability, PolicyVersion, Setting, VersionStatus } from "./types";

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

export interface OrderShape {
  cptCode: string;
  planType: string;
  setting?: Setting;
}

export function cptMatches(a: Applicability, cptCode: string): boolean {
  return a.cptCodes.includes(cptCode);
}
export function planMatches(a: Applicability, planType: string): boolean {
  return a.planTypes === "all" || a.planTypes.includes(planType);
}
export function settingMatches(a: Applicability, setting?: Setting): boolean {
  return a.settings === "all" || setting === undefined || a.settings.includes(setting);
}

export function applicabilityMatches(a: Applicability, o: OrderShape): boolean {
  return cptMatches(a, o.cptCode) && planMatches(a, o.planType) && settingMatches(a, o.setting);
}

/** CPT codes + plan types + settings both claim. Used for cross-policy conflict detection. */
export function sharedClaims(a: Applicability, b: Applicability): { cptCodes: string[]; planTypes: string[] | "all" } | null {
  const cpts = a.cptCodes.filter((c) => b.cptCodes.includes(c));
  if (cpts.length === 0) return null;
  let plans: string[] | "all";
  if (a.planTypes === "all") plans = b.planTypes;
  else if (b.planTypes === "all") plans = a.planTypes;
  else plans = a.planTypes.filter((p) => (b.planTypes as string[]).includes(p));
  if (plans !== "all" && plans.length === 0) return null;
  const settingsOverlap =
    a.settings === "all" || b.settings === "all" || a.settings.some((s) => (b.settings as Setting[]).includes(s));
  if (!settingsOverlap) return null;
  return { cptCodes: cpts, planTypes: plans };
}

export { rangesOverlap };

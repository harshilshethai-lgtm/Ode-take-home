import { diffVersions } from "./diff";
import { versionFor } from "./versionStatus";
import type { PolicyVersion } from "./types";

export interface AffectedItem {
  key: string;
  label: string;
  kind: "added" | "removed" | "changed";
}

export interface Staleness {
  pinned: PolicyVersion;
  /** The published version that governs the evaluation's service date today. Newer than `pinned`. */
  applicable: PolicyVersion;
  /** Criteria whose rule differs between the two versions, by key. */
  affected: AffectedItem[];
  /** Waivers whose rule differs. Reported separately because they are not criteria. */
  affectedWaivers: AffectedItem[];
}

/**
 * Has a newer version taken over for this evaluation's service date? Null means the check is still current:
 * the pinned version still governs that date, or nothing newer does. A future version that has not started yet
 * does not count, and neither does an older version (for example after the scan moved earlier).
 */
export function evaluationStaleness(
  versions: PolicyVersion[],
  e: { policyVersionId: string | null; serviceDate: string },
): Staleness | null {
  if (!e.policyVersionId) return null;
  const pinned = versions.find((v) => v.id === e.policyVersionId);
  if (!pinned) return null;
  const applicable = versionFor(versions, pinned.policyId, e.serviceDate);
  if (!applicable || applicable.id === pinned.id || applicable.versionNumber <= pinned.versionNumber) return null;
  const diff = diffVersions(pinned, applicable);
  const pick = <T extends { key: string; label: string; kind: "added" | "removed" | "changed" | "unchanged" }>(rows: T[]): AffectedItem[] =>
    rows.flatMap((r) => (r.kind === "unchanged" ? [] : [{ key: r.key, label: r.label, kind: r.kind }]));
  return { pinned, applicable, affected: pick(diff.criteria), affectedWaivers: pick(diff.exceptions) };
}

// Published versions never change. The service checks this after every mutation, so a future code path that
// forgets the rule fails loudly instead of rewriting history.

import type { PolicyVersion } from "./types";

/**
 * What a published version may still change: effectiveTo (closed automatically when a later version takes over)
 * and updatedAt (bookkeeping for that). Everything else, including its criteria, is frozen.
 */
function frozenForm(v: PolicyVersion): string {
  const { effectiveTo: _to, updatedAt: _at, ...rest } = v;
  void _to;
  void _at;
  return JSON.stringify(rest);
}

export type PublishedFingerprint = Map<string, string>;

export function publishedFingerprint(versions: PolicyVersion[]): PublishedFingerprint {
  return new Map(versions.filter((v) => v.status === "published").map((v) => [v.id, frozenForm(v)]));
}

/** Ids of previously published versions that were modified or removed since `before`. */
export function changedPublished(before: PublishedFingerprint, versions: PolicyVersion[]): string[] {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const changed: string[] = [];
  for (const [id, form] of before) {
    const now = byId.get(id);
    if (!now || frozenForm(now) !== form) changed.push(id);
  }
  return changed;
}

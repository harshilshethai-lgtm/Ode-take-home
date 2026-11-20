import type { RoutingContext, RoutingMode, RoutingPolicy, RoutingRule } from "./types";

const SCOPE_RANK = {
  failureType: 4,
  studyType: 3,
  insurer: 2,
  hospital: 1,
} as const;

type ScopeKey = keyof typeof SCOPE_RANK;

/**
 * Most specific scope wins: failure type, then study type, then insurer, then hospital, then global.
 * A rule matches when every scope field it sets equals the context. Among matches, the highest-ranked
 * field wins; a rule that also sets more fields wins a tie; otherwise the earlier rule wins.
 */
export function resolveRouting(policy: RoutingPolicy, ctx: RoutingContext): { mode: RoutingMode; version: string; index: number } {
  const matching = policy.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => ruleMatches(rule, ctx));

  if (matching.length === 0) {
    throw new Error(`No routing policy matches (version ${policy.version})`);
  }

  matching.sort((a, b) => {
    const sa = specificity(a.rule);
    const sb = specificity(b.rule);
    if (sa.rank !== sb.rank) return sb.rank - sa.rank;
    if (sa.fields !== sb.fields) return sb.fields - sa.fields;
    return a.index - b.index;
  });

  const winner = matching[0];
  return { mode: winner.rule.mode, version: policy.version, index: winner.index };
}

function ruleMatches(rule: RoutingRule, ctx: RoutingContext): boolean {
  for (const key of Object.keys(SCOPE_RANK) as ScopeKey[]) {
    const required = rule[key];
    if (required !== undefined && required !== ctx[key]) return false;
  }
  return true;
}

function specificity(rule: RoutingRule): { rank: number; fields: number } {
  let rank = 0;
  let fields = 0;
  for (const key of Object.keys(SCOPE_RANK) as ScopeKey[]) {
    if (rule[key] !== undefined) {
      fields += 1;
      rank = Math.max(rank, SCOPE_RANK[key]);
    }
  }
  return { rank, fields };
}

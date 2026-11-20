// Policy-level properties with a known meaning. Everything else on PolicyVersion.properties is free-form and shown
// as written. When an insurer does not state one of these, the property is absent and the helper says so.

import type { Channel, IncompleteHandling, Property } from "./types";

export const POLICY_PROPERTY = {
  planTypes: "plan_types",
  channels: "channels",
  attachments: "attachments",
  incompleteRequests: "incomplete_requests",
} as const;

type HasProperties = { properties: Property[] };

const find = (v: HasProperties, key: string) => v.properties.find((p) => p.key === key);
const list = (p: Property | undefined) => (p && Array.isArray(p.value) ? p.value : []);

/** Plan types the policy is limited to, or "all" when the insurer does not limit it. */
export function planTypesOf(v: HasProperties): string[] | "all" {
  const plans = list(find(v, POLICY_PROPERTY.planTypes));
  return plans.length ? plans : "all";
}

const CHANNELS: Channel[] = ["api", "portal", "fax"];
export function channelsOf(v: HasProperties): Channel[] {
  return list(find(v, POLICY_PROPERTY.channels)).filter((c): c is Channel => (CHANNELS as string[]).includes(c));
}

export function attachmentsOf(v: HasProperties): string[] {
  return list(find(v, POLICY_PROPERTY.attachments));
}

export function incompleteHandlingOf(v: HasProperties): IncompleteHandling {
  const value = find(v, POLICY_PROPERTY.incompleteRequests)?.value;
  return value === "amendable" || value === "deny_resubmit_new" ? value : "unspecified";
}

/** Replace (or add, or with null remove) one known property, keeping the rest in order. */
export function withPolicyProperty(properties: Property[], key: string, next: Property | null): Property[] {
  const i = properties.findIndex((p) => p.key === key);
  if (!next) return i < 0 ? properties : properties.filter((_, j) => j !== i);
  if (i < 0) return [...properties, next];
  return properties.map((p, j) => (j === i ? next : p));
}

/** Number of things in a version that encode an inference: criteria with an assumed property, plus assumed exceptions and policy properties. */
export function assumptionCount(v: { properties: Property[]; criteria: HasProperties[]; exceptions: Array<{ assumption: string | null }> }): number {
  const assumed = (x: HasProperties) => x.properties.some((p) => !!p.assumption);
  return v.criteria.filter(assumed).length + v.exceptions.filter((e) => !!e.assumption).length + v.properties.filter((p) => !!p.assumption).length;
}

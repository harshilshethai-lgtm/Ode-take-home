// Plain-English text for rules: criteria are described by their properties, policies by theirs.

import { SOURCE_LABEL_PLURAL, capitalize, humanize, joinList } from "./common";
import { POLICY_PROPERTY, planTypesOf } from "./policyProperties";
import type { Applicability, Channel, IncompleteHandling, PolicyException, Property, SourceType } from "./types";

const PLAN_LABEL: Record<string, string> = {
  commercial_hmo: "commercial HMO",
  commercial_ppo: "commercial PPO",
  commercial_epo: "commercial EPO",
  medicare_advantage: "Medicare Advantage",
  medicaid_managed_care: "Medicaid managed care",
};

export function planTypeLabel(planType: string): string {
  return PLAN_LABEL[planType] ?? humanize(planType);
}

const CHANNEL_ORDER: Channel[] = ["portal", "api", "fax"];
const CHANNEL_LABEL: Record<Channel, string> = { portal: "portal", api: "API", fax: "fax" };

export function describeChannels(channels: Channel[]): string {
  const ordered = CHANNEL_ORDER.filter((c) => channels.includes(c));
  if (ordered.length === 0) return "No channel specified";
  if (ordered.length === 1) return `${capitalize(CHANNEL_LABEL[ordered[0]])} only`;
  return capitalize(joinList(ordered.map((c) => CHANNEL_LABEL[c]), "or"));
}

export const INCOMPLETE_LABEL: Record<IncompleteHandling, string> = {
  amendable: "can be amended",
  deny_resubmit_new: "denied, must resubmit as new",
  unspecified: "not specified by the payer",
};

/** "6 weeks", "PT notes or clinic notes from the treating provider", "Yes". */
export function describeValue(p: Pick<Property, "key" | "value" | "unit" | "check">): string {
  const { value } = p;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!p.unit) return String(value);
    return `${value} ${value === 1 ? p.unit.replace(/s$/, "") : p.unit}`;
  }
  if (Array.isArray(value)) {
    if (p.check?.op === "source_in" || p.check?.op === "source_not_in") {
      return joinList(value.map((s) => SOURCE_LABEL_PLURAL[s as SourceType] ?? humanize(s)), p.check.op === "source_in" ? "or" : "and");
    }
    if (p.key === POLICY_PROPERTY.planTypes) return joinList(value.map(planTypeLabel), "or");
    if (p.key === POLICY_PROPERTY.channels) return describeChannels(value as Channel[]);
    return value.join(", ") || "(none)";
  }
  if (p.key === POLICY_PROPERTY.incompleteRequests) return INCOMPLETE_LABEL[value as IncompleteHandling] ?? value;
  return value;
}

/** "Duration: 6 weeks; Lookback: 6 months." */
export function describeCriterion(c: { properties: Property[] }): string {
  if (c.properties.length === 0) return "No properties.";
  return c.properties.map((p) => `${p.label}: ${describeValue(p)}`).join("; ") + ".";
}

export function describeTrigger(slug: string): string {
  return humanize(slug);
}

export function describeApplicability(a: Applicability, v: { properties: Property[] }): string {
  const cpt = `CPT ${a.cptCodes.join(", ") || "(none)"}`;
  const planTypes = planTypesOf(v);
  const plans = planTypes === "all" ? "All plans" : capitalize(joinList(planTypes.map(planTypeLabel), "or")) + " plans only";
  const settings = a.settings === "all" ? "All settings" : joinList(a.settings.map(capitalize), "or");
  return `${cpt} · ${plans} · ${settings}`;
}

/** "If any of [a, b], these criteria are waived: [labels]" */
export function describeException(e: Pick<PolicyException, "triggers" | "waivesCriterionKeys">, labelFor: (key: string) => string): string {
  const triggers = e.triggers.map(describeTrigger).join("; ") || "(no triggers)";
  const waives = e.waivesCriterionKeys.map(labelFor).join(", ") || "(none)";
  return `If any of: ${triggers}, the following are waived: ${waives}.`;
}

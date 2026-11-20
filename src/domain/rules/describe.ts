// Plain-English text for everything that is not a criterion (criteria use their primitive's describe()).

import { capitalize, humanize, joinList } from "./common";
import { getPrimitive } from "./primitives/registry";
import type {
  Applicability,
  Channel,
  Criterion,
  IncompleteHandling,
  PolicyException,
  Submission,
} from "./types";

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

/** describe() for any criterion. Falls back gracefully if the primitive is unknown or params are invalid. */
export function describeCriterion(c: Pick<Criterion, "type" | "params">): string {
  const prim = getPrimitive(c.type);
  if (!prim) return `Unknown rule type "${c.type}".`;
  const parsed = prim.paramsSchema.safeParse(c.params);
  if (!parsed.success) return `${prim.label}: parameters are incomplete.`;
  return prim.describe(parsed.data);
}

export function describeTrigger(slug: string): string {
  return humanize(slug);
}

export function describeApplicability(a: Applicability): string {
  const cpt = `CPT ${a.cptCodes.join(", ") || "(none)"}`;
  const plans = a.planTypes === "all" ? "All plans" : capitalize(joinList(a.planTypes.map(planTypeLabel), "or")) + " plans only";
  const settings = a.settings === "all" ? "All settings" : joinList(a.settings.map(capitalize), "or");
  return `${cpt} · ${plans} · ${settings}`;
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

export function describeSubmission(s: Submission): string {
  const parts = [describeChannels(s.channels)];
  if (s.requiredAttachments.length) parts.push(`Attach: ${s.requiredAttachments.join(", ")}`);
  parts.push(`Incomplete requests: ${INCOMPLETE_LABEL[s.incompleteRequestHandling]}`);
  return parts.join(" · ");
}

/** "If any of [a, b], these criteria are waived: [labels]" */
export function describeException(e: Pick<PolicyException, "triggers" | "waivesCriterionKeys">, labelFor: (key: string) => string): string {
  const triggers = e.triggers.map(describeTrigger).join("; ") || "(no triggers)";
  const waives = e.waivesCriterionKeys.map(labelFor).join(", ") || "(none)";
  return `If any of: ${triggers}, the following are waived: ${waives}.`;
}

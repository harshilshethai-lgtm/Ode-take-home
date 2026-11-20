import type { AffectedItem } from "@/domain/rules/staleness";

/** Where a version is shown in the rule library. */
export const versionHref = (policyId: string, versionId: string) =>
  `/settings?policy=${encodeURIComponent(policyId)}&v=${encodeURIComponent(versionId)}`;

export const checkedAgainstText = (s: { payerName: string; externalPolicyId: string; versionNumber: number }) =>
  `Checked against ${s.payerName} ${s.externalPolicyId} v${s.versionNumber}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Rules changed since this check (v3 → v4) · 1 criterion affected" */
export function rulesChangedText(from: number, to: number, affected: AffectedItem[], waivers: AffectedItem[] = []): string {
  const base = `Rules changed since this check (v${from} → v${to})`;
  if (affected.length > 0) return `${base} · ${plural(affected.length, "criterion", "criteria")} affected`;
  if (waivers.length > 0) return `${base} · ${plural(waivers.length, "waiver", "waivers")} affected`;
  return `${base} · no criteria affected`;
}

const KIND: Record<AffectedItem["kind"], string> = { added: "added", removed: "removed", changed: "changed" };

/** "Symptom duration (changed), Prior X-ray (added)" */
export const affectedList = (items: AffectedItem[]): string => items.map((i) => `${i.label} (${KIND[i.kind]})`).join(", ");

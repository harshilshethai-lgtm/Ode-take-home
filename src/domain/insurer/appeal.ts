import type { TrackedOrder } from "./types";

/** A draft the nurse edits. Nothing is sent until File appeal. */
export function draftAppeal(order: TrackedOrder, denialReason: string): string {
  const lines = [`${order.insurerName} denied this request: "${denialReason}".`];
  if (order.policyText) lines.push(order.policyText);
  const cited = order.criteria.filter((item) => item.result === "MET" || item.result === "WAIVED" || item.result === "EXCEPTION_MET");
  for (const item of cited) {
    const page = item.page ? ` p.${item.page}` : "";
    const quote = item.quote ? ` "${item.quote}"${page}` : "";
    lines.push(`${item.label} is met.${quote}`);
  }
  lines.push("Please reconsider the request.");
  return lines.join(" ");
}

export function daysLeft(deadline: string | null | undefined, now: Date): number | null {
  if (!deadline) return null;
  const end = new Date(deadline.includes("T") ? deadline : `${deadline}T23:59:00`);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

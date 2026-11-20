import { ORDER_STATUS_INFO, orderExits, documentExits, DOCUMENT_STATUSES, ORDER_STATUSES } from "./catalog";
import { DOCUMENT_STATUS_INFO } from "./catalog";

/** Markdown listing every status, its meaning and its exits. Built from the transition maps. */
export function renderStatusCatalog(): string {
  const lines: string[] = ["## Status catalog", "", "Generated from the order and document transition maps. Do not edit by hand.", ""];
  lines.push("### Orders", "");
  for (const status of ORDER_STATUSES) {
    const info = ORDER_STATUS_INFO[status];
    const exits = orderExits(status);
    lines.push(`- **${info.label}** (\`${status}\`): ${info.meaning} Exits: ${exits.length ? exits.join(", ") : "(none)"}.`);
  }
  lines.push("", "### Documents", "");
  for (const status of DOCUMENT_STATUSES) {
    const info = DOCUMENT_STATUS_INFO[status];
    const exits = documentExits(status);
    lines.push(`- **${info.label}** (\`${status}\`): ${info.meaning} Exits: ${exits.length ? exits.join(", ") : "(none)"}.`);
  }
  lines.push("");
  return lines.join("\n");
}

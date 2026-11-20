import type { InsurerConfig } from "./config";
import type { ApprovalOffer, TrackedOrder } from "./types";

export type MismatchType = "cpt" | "side" | "dates" | "facility" | "provider" | "units";

export interface Mismatch {
  type: MismatchType;
  ordered: string;
  approved: string;
}

function dayValue(iso: string): number {
  const raw = iso.includes("T") ? iso : `${iso}T12:00:00`;
  const date = new Date(raw);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sameFamily(config: InsurerConfig, ordered: string, approved: string): boolean {
  if (ordered === approved) return true;
  return config.cptFamilies.some((family) => family.includes(ordered) && family.includes(approved));
}

/** Every approval has to cover the order before the order can be Approved. */
export function approvalMismatches(order: TrackedOrder, offer: ApprovalOffer, config: InsurerConfig): Mismatch[] {
  const found: Mismatch[] = [];
  if (!sameFamily(config, order.cpt, offer.cpt)) {
    found.push({ type: "cpt", ordered: `CPT ${order.cpt}`, approved: `CPT ${offer.cpt}` });
  }
  if (order.side && (offer.side ?? "").toLowerCase() !== order.side.toLowerCase()) {
    found.push({ type: "side", ordered: order.side, approved: offer.side || "no side" });
  }
  if (order.scanAt) {
    const scan = dayValue(order.scanAt);
    const from = dayValue(offer.validFrom);
    const to = dayValue(offer.validTo);
    if (scan < from || scan > to) {
      found.push({ type: "dates", ordered: order.scanAt.slice(0, 10), approved: `${offer.validFrom} to ${offer.validTo}` });
    }
  }
  if (config.tiesFacility && (offer.facility ?? "") !== (order.facility ?? "")) {
    found.push({ type: "facility", ordered: order.facility || "no facility", approved: offer.facility || "no facility" });
  }
  if (config.tiesProvider && (offer.provider ?? "") !== (order.provider ?? "")) {
    found.push({ type: "provider", ordered: order.provider || "no provider", approved: offer.provider || "no provider" });
  }
  const units = offer.units ?? 1;
  if (units < order.units) found.push({ type: "units", ordered: `${order.units} units`, approved: `${units} units` });
  return found;
}

// Member ID comes from the packet when the page has it, otherwise from the Epic eligibility mock.

import type { Order } from "@/domain/types";
import { DEMO_NOW } from "@/lib/demoClock";
import { eligibilityFor } from "@/lib/mocks/eligibility";

export interface MemberIdFact {
  value: string;
  source: "pdf" | "epic";
  page?: number;
  quote?: string;
  ranAt?: string;
}

/** IDs read off the packet. Kirk's packet does not contain one. */
const FROM_PACKET: Record<string, { value: string; page: number; quote: string }> = {
  "case-2-scott": { value: "FBG-0047-1979", page: 2, quote: "FBG-0047-1979" },
  "case-3-sulu": { value: "AL-1701-0914", page: 1, quote: "AL-1701-0914" },
};

export function memberIdFor(order: Pick<Order, "id" | "patient">): MemberIdFact | null {
  const printed = FROM_PACKET[order.id];
  if (printed) return { value: printed.value, source: "pdf", page: printed.page, quote: printed.quote };
  const epic = eligibilityFor(order.patient?.mrn);
  if (!epic?.memberId) return null;
  return { value: epic.memberId, source: "epic", ranAt: DEMO_NOW.toISOString() };
}

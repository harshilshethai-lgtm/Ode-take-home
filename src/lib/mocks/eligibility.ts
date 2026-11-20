// Stand-in for an Epic coverage lookup. Keyed by MRN. Used only to fill fields the packet left blank.

export interface Eligibility {
  payer: string;
  planType: string;
  memberId: string;
}

export const ELIGIBILITY_BY_MRN: Record<string, Eligibility> = {
  "HH-0017011": { payer: "Federation Health", planType: "ppo", memberId: "FH-1701-1981" },
  "HH-0017042": { payer: "Ferengi Benefit Group", planType: "commercial_hmo", memberId: "FBG-0047-1979" },
  "HH-0017058": { payer: "Andorian Life", planType: "epo", memberId: "AL-1701-0914" },
};

export function eligibilityFor(mrn: string | null | undefined): Eligibility | null {
  if (!mrn) return null;
  return ELIGIBILITY_BY_MRN[mrn] ?? null;
}

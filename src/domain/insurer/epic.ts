import type { ApprovalOffer } from "./types";

export interface EpicAuthRecord {
  authId: string;
  orderId: string;
  cpt: string;
  units: number;
  validFrom: string;
  validTo: string;
}

export interface EpicClient {
  writeAuthorization(orderId: string, approval: ApprovalOffer): Promise<{ authId: string }>;
  readAuthorization(orderId: string): Promise<EpicAuthRecord | null>;
}

/** In-memory Epic. `failures` is how many writes throw before one succeeds. */
export function scriptedEpic(failures = 0): EpicClient & { writes: number } {
  const saved = new Map<string, EpicAuthRecord>();
  const client = {
    writes: 0,
    async writeAuthorization(orderId: string, approval: ApprovalOffer) {
      client.writes += 1;
      if (client.writes <= failures) throw new Error("Epic timed out");
      const authId = `E-${approval.number}`;
      saved.set(orderId, {
        authId,
        orderId,
        cpt: approval.cpt,
        units: approval.units ?? 1,
        validFrom: approval.validFrom,
        validTo: approval.validTo,
      });
      return { authId };
    },
    async readAuthorization(orderId: string) {
      const row = saved.get(orderId);
      return row ? { ...row } : null;
    },
  };
  return client;
}

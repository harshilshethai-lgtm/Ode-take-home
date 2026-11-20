import type { DocumentStatus, OrderStatus } from "@/domain/priorAuth/types";
import type { Channel } from "@/domain/statuses";

export type CheckResult = "MET" | "NOT_MET" | "UNCLEAR" | "WAIVED" | "EXCEPTION_MET" | "FIXED";

export interface CheckRow {
  id: string;
  result: CheckResult;
  label: string;
  found: string;
  docId?: string;
  page?: number;
  /** Short quote the page chip highlights. Under 12 words. */
  quote?: string;
}

export interface ReviewPanel {
  status: OrderStatus;
  confirmOnly: boolean;
  linked: boolean;
  urgent: boolean;
  /** Null when the order did not arrive on a submission channel (a blank fax, for example). */
  orderChannel: Channel | null;
  headline: string;
  context: { policyId: string; policyRev: number; channel: "api" | "portal"; constraint?: string };
  /** False when `context.channel` is only a placeholder because the order has no channel. */
  channelKnown: boolean;
  scan: { at?: string; deadline?: string; risk: "on_track" | "at_risk" | "slot_at_risk" };
  toResolve: Array<{
    text: string;
    owner: string;
    contact?: string;
    action?: { label: string; transition?: OrderStatus; sideEffect?: string };
    due?: string;
    readOnly: boolean;
  }>;
  checks: {
    consistency: CheckRow[];
    criteria: { policyId: string; rev: number; assumption?: string; rows: CheckRow[] };
    evaluatedAt: string;
    /** When the attached packet was received. Shown next to the evaluation time. */
    receivedAt?: string;
    receivedKind: "fax" | "record";
    summary: { failed: number; unclear: number; passed: number; waived: number };
  };
  evidence: Array<{
    fact: string;
    forCheckId: string;
    rows: Array<{ source: string; value: string; conflict: boolean; quote: string; docId: string; page: number }>;
  }>;
  coverage: CheckRow[];
  documentNotes: CheckRow[];
  documents: Array<{ id: string; type: string; status: DocumentStatus; pages: number }>;
  activity: Array<{ at: string; actor: string; from: string; to: string; reason: string }>;
}

import type { AuthState } from "@/domain/priorAuth/store";
import type { InsurerInteraction } from "./types";

interface LogState {
  rows: InsurerInteraction[];
  seq: number;
}

const logs = new WeakMap<AuthState, LogState>();

function bucket(state: AuthState): LogState {
  let found = logs.get(state);
  if (!found) {
    found = { rows: [], seq: 1 };
    logs.set(state, found);
  }
  return found;
}

function copy(row: InsurerInteraction): InsurerInteraction {
  return {
    ...row,
    error: row.error ? { ...row.error } : undefined,
    attachmentsSent: row.attachmentsSent?.map((item) => ({ docId: item.docId, pages: [...item.pages] })),
  };
}

/** Append-only. There is no update. Portal automation rows must carry a screenshot and a script version. */
export function appendInteraction(state: AuthState, row: Omit<InsurerInteraction, "id">): InsurerInteraction {
  if (row.channel === "portal_automation" && (!row.screenshotUrl || !row.scriptVersion)) {
    throw new Error("Portal automation rows need a screenshot and a script version");
  }
  const data = bucket(state);
  const saved = copy({ ...row, id: `ix_${data.seq}` });
  data.seq += 1;
  data.rows.push(saved);
  return copy(saved);
}

export function readInteractions(state: AuthState, orderId?: string): InsurerInteraction[] {
  return bucket(state)
    .rows.filter((row) => orderId === undefined || row.orderId === orderId)
    .map(copy);
}

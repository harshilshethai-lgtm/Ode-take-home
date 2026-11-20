// What a coordinator pastes and uploads for a manual portal submit, in order.

import { memberIdFor } from "@/domain/memberId";
import { normalizeProvider } from "@/domain/providers";
import type { CaseRecord } from "@/domain/caseRecord";
import type { Order } from "@/domain/types";

export interface PortalField {
  label: string;
  value: string;
}

export interface PortalFile {
  label: string;
  detail: string;
}

export interface PortalPacket {
  fields: PortalField[];
  files: PortalFile[];
}

export function portalPacketFor(order: Order, record: CaseRecord): PortalPacket | null {
  if (order.reasonCode !== "PORTAL_UPLOAD") return null;
  const member = memberIdFor(order);
  const provider = record.elements.find((item) => item.label === "Ordering provider");
  const name = provider ? normalizeProvider(provider.value) : null;
  const fields: PortalField[] = [
    { label: "Patient", value: order.patient?.name ?? "" },
    { label: "Member ID", value: member?.value ?? "" },
    { label: "CPT", value: order.cpt ?? "" },
    { label: "Insurer", value: order.insurer ?? "" },
    { label: "Provider", value: name ? (name.parsed ? name.detail : name.raw) : "" },
  ].filter((field) => field.value);
  const pages = Math.max(order.attachmentCount, 1);
  const title = record.documents[0]?.title ?? "Packet";
  return {
    fields,
    files: [{ label: title, detail: pages === 1 ? "Page 1" : `Pages 1–${pages}, in order` }],
  };
}

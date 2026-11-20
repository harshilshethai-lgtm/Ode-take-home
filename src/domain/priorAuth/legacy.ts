import type { Channel, StatusId } from "../statuses";
import type { Channel as AuthChannel, OrderStatus, ProcessingStep, ReasonCode } from "./types";
import { migrateOrder } from "./migrate";

const TO_ORDER = {
  processing: "PROCESSING",
  needs_admin_review: "NEEDS_ADMIN_REVIEW",
  needs_clinical_review: "NEEDS_CLINICAL_REVIEW",
  submitted: "SUBMITTED",
  approved: "APPROVED",
  not_required: "NOT_REQUIRED",
  denied: "DENIED",
  cancelled: "CANCELLED",
} as const satisfies Record<StatusId, OrderStatus>;

const TO_LEGACY = Object.fromEntries(Object.entries(TO_ORDER).map(([legacy, status]) => [status, legacy])) as {
  [K in OrderStatus]: StatusId;
};

export function toOrderStatus(status: StatusId): OrderStatus {
  return TO_ORDER[status];
}

export function toStatusId(status: OrderStatus): StatusId {
  return TO_LEGACY[status];
}

export function toChannel(channel: Channel | null): AuthChannel | null {
  return channel;
}

export function toReasonCode(code: string | null | undefined): ReasonCode | null {
  if (!code) return null;
  return code as ReasonCode;
}

export function legacyRow(status: string, extra: { channel?: Channel | null; blockingChecks?: string[]; confirmOnly?: boolean } = {}) {
  return migrateOrder({ status, channel: extra.channel, blockingChecks: extra.blockingChecks, confirmOnly: extra.confirmOnly });
}

export type { ProcessingStep, ReasonCode };

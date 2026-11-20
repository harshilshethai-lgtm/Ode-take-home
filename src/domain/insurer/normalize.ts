import type { NormalizedStatus } from "./types";

/** Versioned raw-text tables. UNKNOWN is anything that is not listed. */
export const NORMALIZATION_VERSION = "2026.11.1";

const SHARED: ReadonlyArray<readonly [string, NormalizedStatus]> = [
  ["received", "RECEIVED"],
  ["in review", "IN_REVIEW"],
  ["pended", "PENDED"],
  ["clinical review", "PENDED"],
  ["more information", "MORE_INFO_NEEDED"],
  ["more info needed", "MORE_INFO_NEEDED"],
  ["peer to peer", "PEER_TO_PEER_REQUESTED"],
  ["peer-to-peer", "PEER_TO_PEER_REQUESTED"],
  ["approved", "APPROVED"],
  ["partially approved", "PARTIALLY_APPROVED"],
  ["partial approval", "PARTIALLY_APPROVED"],
  ["denied", "DENIED"],
];

export const STATUS_TABLES: Record<string, ReadonlyArray<readonly [string, NormalizedStatus]>> = {
  "Federation Health": SHARED,
  "Vulcan Science Mutual": SHARED,
  "Klingon Assurance": SHARED,
  "Bajoran Health Plan": SHARED,
  "Ferengi Benefit Group": SHARED,
  "Andorian Life": SHARED,
};

export function normalizeStatus(insurerId: string, raw: string): NormalizedStatus {
  const table = STATUS_TABLES[insurerId] ?? SHARED;
  const key = raw.trim().toLowerCase();
  const hit = table.find(([phrase]) => phrase === key);
  return hit ? hit[1] : "UNKNOWN";
}

export const NORMALIZED_LABEL: Record<NormalizedStatus, string> = {
  RECEIVED: "Received",
  IN_REVIEW: "In review",
  PENDED: "Pended",
  MORE_INFO_NEEDED: "More info",
  PEER_TO_PEER_REQUESTED: "Peer-to-peer",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Partially approved",
  DENIED: "Denied",
  UNKNOWN: "Unknown",
};

export const ERROR_LABEL: Record<string, string> = {
  timeout: "Timed out",
  auth_failed: "Sign-in failed",
  captcha: "Captcha",
  page_changed: "Page changed",
  validation: "Rejected",
  http: "HTTP error",
  unknown: "Unknown error",
};

export function channelWords(channel: "api" | "portal_automation" | "manual"): string {
  if (channel === "api") return "API";
  if (channel === "portal_automation") return "portal";
  return "manual";
}

export function channelBadge(channel: "api" | "portal_automation" | "manual"): string {
  if (channel === "api") return "API";
  if (channel === "portal_automation") return "Portal automation";
  return "Manual";
}

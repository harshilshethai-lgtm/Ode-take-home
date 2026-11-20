import type { Order } from "@/domain/types";
import { nextCheckLabel } from "@/lib/demoClock";
import { fmtTableDate } from "@/lib/format";
import { channelBadge, NORMALIZED_LABEL } from "./normalize";
import { readTrack } from "./runner";
import type { AuthState } from "@/domain/priorAuth/store";
import type { InsurerChannel, InsurerInteraction, NormalizedStatus } from "./types";

export interface InsurerTimelineRow {
  id: string;
  kind: "eligibility" | "lookup" | "submission" | "status" | "appeal";
  time: string;
  channel: string;
  result: string;
  screenshotUrl?: string;
  error?: string;
}

export interface InsurerPanelModel {
  insurerName: string;
  plan: string | null;
  channelLabel: string;
  reference: string | null;
  submittedLabel: string | null;
  submittedBy: string;
  latestLabel: string | null;
  latestRaw: string | null;
  lastCheckedLabel: string | null;
  nextCheckLabel: string | null;
  nextCheckAt: string | null;
  approval: { number: string; cpt: string; units: string; validFrom: string; validTo: string; matched: boolean } | null;
  sent: Array<{ label: string; pages: string }>;
  packetUrl: string | null;
  timeline: InsurerTimelineRow[];
  appeal: { reason: string; deadline: string | null; daysLeft: string | null; draft: string; reference: string | null } | null;
}

const KIND = {
  eligibility: "eligibility",
  existing_approval: "lookup",
  submission: "submission",
  status_check: "status",
  appeal_submission: "appeal",
} as const;

function quote(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { detail?: string; status?: string; items?: string };
    return parsed.detail || parsed.items || parsed.status || raw;
  } catch {
    return raw;
  }
}

function collapse(rows: InsurerInteraction[]): Array<InsurerInteraction | { collapsed: InsurerInteraction[]; }> {
  const newestFirst = [...rows].reverse();
  const out: Array<InsurerInteraction | { collapsed: InsurerInteraction[] }> = [];
  let index = 0;
  while (index < newestFirst.length) {
    const row = newestFirst[index];
    if (!row) break;
    if (row.kind !== "status_check" || row.outcome !== "ok" || !row.normalized) {
      out.push(row);
      index += 1;
      continue;
    }
    const group = [row];
    let next = index + 1;
    while (next < newestFirst.length) {
      const older = newestFirst[next];
      if (!older || older.kind !== "status_check" || older.outcome !== "ok" || older.normalized !== row.normalized) break;
      group.push(older);
      next += 1;
    }
    if (group.length > 1) out.push({ collapsed: group });
    else out.push(row);
    index = next;
  }
  return out;
}

export function buildInsurerPanel(args: {
  insurerName: string;
  plan: string | null;
  channel: InsurerChannel;
  interactions: InsurerInteraction[];
  approval?: { number: string; cpt: string; units?: number | null; validFrom: string; validTo: string } | null;
  matched?: boolean | null;
  packetUrl?: string | null;
  nextCheckAt?: string | null;
  draft?: string | null;
  denialReason?: string | null;
  deadline?: string | null;
  daysLeft?: number | null;
  now?: Date;
}): InsurerPanelModel | null {
  if (args.interactions.length === 0) return null;
  const newest = [...args.interactions].reverse();
  const submission = args.interactions.find((row) => row.kind === "submission" || row.kind === "appeal_submission");
  const latest = newest.find((row) => row.normalized || row.rawResponse);
  const checks = newest.filter((row) => row.kind === "status_check");
  const lastCheck = checks[0];
  const sent = submission?.attachmentsSent ?? [];
  const appealReference = [...args.interactions].reverse().find((row) => row.kind === "appeal_submission")?.reference ?? null;
  return {
    insurerName: args.insurerName,
    plan: args.plan,
    channelLabel: channelBadge(args.channel),
    reference: newest.find((row) => row.reference)?.reference ?? null,
    submittedLabel: submission ? fmtTableDate(new Date(submission.finishedAt)) : null,
    submittedBy: submission?.actor === "system" ? "System" : submission?.actor ?? "System",
    latestLabel: latest?.normalized ? NORMALIZED_LABEL[latest.normalized] : null,
    latestRaw: latestRawText(latest),
    lastCheckedLabel: lastCheck ? fmtTableDate(new Date(lastCheck.finishedAt)) : null,
    nextCheckLabel: args.nextCheckAt ? nextCheckLabel(args.nextCheckAt) : null,
    nextCheckAt: args.nextCheckAt ?? null,
    approval: args.approval
      ? {
          number: args.approval.number,
          cpt: args.approval.cpt,
          units: String(args.approval.units ?? 1),
          validFrom: args.approval.validFrom.slice(0, 10),
          validTo: args.approval.validTo.slice(0, 10),
          matched: args.matched !== false,
        }
      : null,
    sent: sent.map((item) => ({ label: item.docId, pages: item.pages.join(", ") })),
    packetUrl: args.packetUrl ?? null,
    timeline: dedupeResults(collapse(args.interactions).map((entry) => {
      if ("collapsed" in entry) {
        const last = entry.collapsed[0];
        return {
          id: `group-${last?.id ?? "checks"}`,
          kind: "status" as const,
          time: last ? fmtTableDate(new Date(last.finishedAt)) : "",
          channel: channelBadge(last?.channel ?? args.channel),
          result: `${entry.collapsed.length} checks, no change, last ${last ? fmtTableDate(new Date(last.finishedAt)) : ""}`,
        };
      }
      return {
        id: entry.id,
        kind: KIND[entry.kind],
        time: fmtTableDate(new Date(entry.finishedAt)),
        channel: channelBadge(entry.channel),
        result: entry.outcome === "error" ? "Failed" : entry.normalized ? NORMALIZED_LABEL[entry.normalized as NormalizedStatus] : "Sent",
        screenshotUrl: entry.screenshotUrl,
        error: entry.error ? `${ERROR_WORD[entry.error.type] ?? "Error"}` : undefined,
      };
    })),
    appeal: args.denialReason
      ? {
          reason: args.denialReason,
          deadline: args.deadline ?? null,
          daysLeft: args.daysLeft == null ? null : `${args.daysLeft} days left`,
          draft: args.draft ?? "",
          reference: appealReference,
        }
      : null,
  };
}

function latestRawText(latest: InsurerInteraction | undefined): string | null {
  if (!latest) return null;
  const raw = quote(latest.rawResponse).trim();
  const label = latest.normalized ? NORMALIZED_LABEL[latest.normalized] : null;
  if (!raw) return null;
  if (label && raw.toLowerCase() === label.toLowerCase()) return null;
  if (latest.normalized && raw.toLowerCase() === latest.normalized.toLowerCase()) return null;
  return raw;
}

function dedupeResults(rows: InsurerTimelineRow[]): InsurerTimelineRow[] {
  const out: InsurerTimelineRow[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.result === row.result) continue;
    out.push(row);
  }
  return out;
}

const ERROR_WORD: Record<string, string> = {
  timeout: "Timed out",
  auth_failed: "Sign-in failed",
  captcha: "Captcha",
  page_changed: "Page changed",
  validation: "Rejected",
  http: "HTTP error",
  unknown: "Unknown error",
};

export function panelFromState(state: AuthState, order: { insurerName: string; plan: string | null; id: string }, channel: InsurerChannel, interactions: InsurerInteraction[], approval: InsurerPanelModel["approval"], extras: { draft?: string | null; denialReason?: string | null; deadline?: string | null; daysLeft?: number | null } = {}): InsurerPanelModel | null {
  const track = readTrack(state, order.id);
  return buildInsurerPanel({
    insurerName: order.insurerName,
    plan: order.plan,
    channel,
    interactions,
    approval: approval ? { number: approval.number, cpt: approval.cpt, units: Number(approval.units), validFrom: approval.validFrom, validTo: approval.validTo } : null,
    matched: track.matched,
    packetUrl: track.packetUrl,
    nextCheckAt: track.nextCheckAt,
    ...extras,
  });
}

/** A display model for a seeded order that has already been sent. */
export function previewInsurerPanel(order: Order): InsurerPanelModel | null {
  if (order.status !== "submitted" && order.status !== "approved") return null;
  const channel: InsurerChannel = order.channel === "portal" ? "portal_automation" : "api";
  const when = order.statusSince;
  const reference = order.detail.ref ? String(order.detail.ref) : order.detail.number ? String(order.detail.number) : null;
  const interactions: InsurerInteraction[] = [];
  if (order.status === "approved" && order.reasonCode === "LINKED_EXISTING") {
    interactions.push({
      id: `${order.id}-lookup`,
      orderId: order.id,
      insurerId: order.insurer ?? "Insurer",
      kind: "existing_approval",
      channel,
      attempt: 1,
      startedAt: when,
      finishedAt: when,
      outcome: "ok",
      reference: reference ?? undefined,
      rawResponse: JSON.stringify({ status: "approved", detail: "Approval on file" }),
      normalized: "APPROVED",
      actor: "system",
    });
  } else if (order.status === "submitted") {
    interactions.push(
      {
        id: `${order.id}-submit`,
        orderId: order.id,
        insurerId: order.insurer ?? "Insurer",
        kind: "submission",
        channel,
        attempt: 1,
        startedAt: when,
        finishedAt: when,
        outcome: "ok",
        reference: reference ?? undefined,
        rawResponse: JSON.stringify({ status: "received" }),
        normalized: "RECEIVED",
        attachmentsSent: [{ docId: "Packet", pages: Array.from({ length: Math.max(order.attachmentCount, 1) }, (_, index) => index + 1) }],
        actor: "system",
        ...(channel === "portal_automation" ? { screenshotUrl: `portal-shot://${order.id}/confirm`, scriptVersion: "2026.11.1" } : {}),
      },
      {
        id: `${order.id}-check`,
        orderId: order.id,
        insurerId: order.insurer ?? "Insurer",
        kind: "status_check",
        channel,
        attempt: 1,
        startedAt: when,
        finishedAt: when,
        outcome: "ok",
        reference: reference ?? undefined,
        rawResponse: JSON.stringify({ status: "received", detail: "received" }),
        normalized: "RECEIVED",
        actor: "system",
        ...(channel === "portal_automation" ? { screenshotUrl: `portal-shot://${order.id}/status`, scriptVersion: "2026.11.1" } : {}),
      },
    );
  }
  return buildInsurerPanel({
    insurerName: order.insurer ?? "Insurer",
    plan: order.plan,
    channel,
    interactions,
    approval: order.status === "approved" && order.detail.number
      ? { number: String(order.detail.number), cpt: String(order.detail.cpt ?? order.cpt ?? ""), validFrom: String(order.detail.validFrom ?? ""), validTo: String(order.detail.validTo ?? ""), units: 1 }
      : null,
    matched: order.status === "approved",
    packetUrl: order.status === "submitted" ? `packet://${order.id}/as-sent` : null,
    nextCheckAt: order.status === "submitted" ? new Date(new Date(when).getTime() + 4 * 36e5).toISOString() : null,
  });
}

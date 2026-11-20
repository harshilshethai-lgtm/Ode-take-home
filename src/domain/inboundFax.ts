// Simulated inbound fax. Scott's second fax completes the packet. Anything still
// in Processing when the clock runs out becomes Needs admin review.

import { DEMO_NOW } from "@/data/orders";
import type { ActivityEntry, Order } from "@/domain/types";
import type { ReasonCode, ReasonDetail, ProcessingStep } from "@/domain/priorAuth/types";
import type { StatusId } from "@/domain/statuses";
import type { FindingFlag } from "@/domain/flags";
import type { OtherIssue } from "@/domain/priorAuth/types";

export const PIPELINE_TIMEOUT_MS = 8_000;
const STEP_MS = 400;

export interface InboundPatch {
  status: StatusId;
  reason: string;
  reasonCode: ReasonCode | null;
  detail: ReasonDetail;
  step: ProcessingStep | null;
  statusSince: string;
  submissionBlocked: boolean;
  attachmentCount: number;
  findings: FindingFlag[];
  otherIssues: OtherIssue[];
  faxAttached: boolean;
  pipelineActivity: ActivityEntry[];
  statusLabel?: string;
  reasonText?: string;
}

export interface InboundPlan {
  completes: boolean;
  steps: Array<{ delayMs: number; patch: InboundPatch }>;
  timeout: InboundPatch;
}

function at(index: number): string {
  return new Date(DEMO_NOW.getTime() + index * 60_000).toISOString();
}

function entry(index: number, from: string, to: string, reason: string): ActivityEntry {
  return { at: at(index), actor: "System", from, to, reason };
}

function timeoutPatch(order: Order): InboundPatch {
  return {
    status: "needs_admin_review",
    reason: "Pipeline timed out before a decision.",
    reasonCode: "STATUS_CHECK_FAILED",
    detail: {
      insurer: order.insurer ?? "the insurer",
      time: "2:00 PM",
      error: "pipeline timed out",
      normalized: "Processing",
    },
    step: null,
    statusSince: at(1),
    submissionBlocked: order.submissionBlocked === true,
    attachmentCount: order.attachmentCount,
    findings: order.findings ?? [],
    otherIssues: order.otherIssues,
    faxAttached: false,
    pipelineActivity: [
      entry(0, "Chase records", "Processing", "Inbound fax pipeline started."),
      entry(1, "Processing", "Needs admin review", "Pipeline timed out before a decision."),
    ],
    reasonText: "Pipeline timed out before a decision.",
  };
}

function scottPlan(order: Order): InboundPlan {
  const log: ActivityEntry[] = [];
  const push = (from: string, to: string, reason: string) => {
    log.push(entry(log.length, from, to, reason));
  };
  const base = {
    submissionBlocked: true,
    attachmentCount: order.attachmentCount,
    findings: order.findings ?? [],
    otherIssues: order.otherIssues,
    faxAttached: false,
    detail: order.detail,
  };
  const step = (status: StatusId, reasonCode: ReasonCode | null, processing: ProcessingStep | null, reasonText: string, extra: Partial<InboundPatch> = {}): InboundPatch => ({
    ...base,
    status,
    reason: reasonText,
    reasonCode,
    step: processing,
    statusSince: at(0),
    pipelineActivity: [...log],
    reasonText,
    ...extra,
  });

  push("Chase records", "Processing", "Matched to Montgomery Scott by name, DOB 06/11/1979, and MRN HH-0017042.");
  const matched = step("processing", null, "MATCHING", log.at(-1)!.reason);

  push("Processing", "Processing", "Attached as document 2. Extraction started.");
  const attached = step("processing", null, "PAGE_CHECKS", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Processing", "Extracted 10 PT visits from 9/29 to 11/6. Pain improved 5 to 4/10, still catching.");
  const extracted = step("processing", null, "EVIDENCE", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Processing", "Rule engine re-ran.");
  const rules = step("processing", null, "RULES", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Processing", "Epic imaging history checked. No knee MRI on record.");
  const imaging = step("processing", null, "EVALUATING", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Processing", "Conservative care met. 39 days of documented PT.");
  const care = step("processing", null, "EVALUATING", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Processing", "Prior MRI met. None on record.");
  const mri = step("processing", null, "EVALUATING", log.at(-1)!.reason, { faxAttached: true, attachmentCount: 2 });

  push("Processing", "Ready · upload to Ferengi portal", "Ready · upload to Ferengi portal.");
  const ready = step("needs_admin_review", "PORTAL_UPLOAD", null, "Meets all 4 criteria. Upload to the Ferengi portal.", {
    faxAttached: true,
    attachmentCount: 2,
    submissionBlocked: false,
    findings: [],
    otherIssues: [],
    detail: { n: 4, insurer: "Ferengi Benefit Group", k: 2 },
    statusLabel: "Ready · upload to Ferengi portal",
    reasonText: undefined,
  });

  const patches = [matched, attached, extracted, rules, imaging, care, mri, ready];
  return {
    completes: true,
    steps: patches.map((patch, index) => ({ delayMs: index === 0 ? 0 : STEP_MS, patch })),
    timeout: timeoutPatch(order),
  };
}

export function planInboundFax(order: Order): InboundPlan {
  if (order.id === "case-2-scott") return scottPlan(order);
  const started = entry(0, "Processing", "Processing", "Inbound fax pipeline started. No second fax is waiting for this patient.");
  return {
    completes: false,
    steps: [
      {
        delayMs: 0,
        patch: {
          status: "processing",
          reason: started.reason,
          reasonCode: null,
          detail: order.detail,
          step: "INTAKE",
          statusSince: started.at,
          submissionBlocked: order.submissionBlocked === true,
          attachmentCount: order.attachmentCount,
          findings: order.findings ?? [],
          otherIssues: order.otherIssues,
          faxAttached: false,
          pipelineActivity: [started],
          reasonText: started.reason,
        },
      },
    ],
    timeout: timeoutPatch(order),
  };
}

export function pipelineDurationMs(plan: InboundPlan): number {
  return plan.steps.reduce((sum, step) => sum + step.delayMs, 0);
}

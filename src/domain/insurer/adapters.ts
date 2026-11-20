import { z } from "zod";
import type { InsurerConfig } from "./config";
import { normalizeStatus } from "./normalize";
import { PORTAL_SCRIPT_VERSION, submitOnPortal, type PortalPage } from "./portalScript";
import type { Secrets } from "./secrets";
import { EMPTY_SECRETS } from "./secrets";
import {
  InsurerRefusal,
  type ApprovalOffer,
  type InsurerAdapter,
  type InsurerErrorType,
  type StatusResult,
  type SubmissionResult,
} from "./types";

const submissionSchema = z.object({ reference: z.string().min(1), status: z.string().min(1) });
const statusSchema = submissionSchema.extend({
  detail: z.string().optional(),
  phone: z.string().optional(),
  deadline: z.string().optional(),
  items: z.string().optional(),
  cpt: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  units: z.number().optional(),
  side: z.string().nullable().optional(),
  facility: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  number: z.string().optional(),
});

export type MockStep =
  | { op: "eligibility"; raw: string; eligible: boolean }
  | { op: "existing"; raw: string; approval: ApprovalOffer | null }
  | { op: "submit"; reference: string; raw: string }
  | { op: "status"; raw: string; note?: string; reference?: string; approval?: ApprovalOffer; phone?: string; deadline?: string; items?: string }
  | { op: "error"; errorType: InsurerErrorType; message: string }
  | { op: "appeal"; reference: string; raw: string };

const scripts = new Map<string, MockStep[]>();
const byReference = new Map<string, { orderId: string; insurerId: string }>();

export function resetScripts(): void {
  scripts.clear();
  byReference.clear();
}

export function scriptOrder(orderId: string, steps: MockStep[]): void {
  scripts.set(orderId, [...steps]);
}

function take(orderId: string, op: MockStep["op"] | "status-or-error"): MockStep {
  const steps = scripts.get(orderId);
  const next = steps?.shift();
  if (!next) throw new InsurerRefusal("unknown", `No scripted response left for ${orderId}`);
  const ok = op === "status-or-error" ? next.op === "status" || next.op === "error" : next.op === op;
  if (!ok) throw new InsurerRefusal("unknown", `Expected ${op} and the script had ${next.op}`);
  return next;
}

function portalArtifacts(config: InsurerConfig, orderId: string, raw: string): { screenshotUrl?: string; scriptVersion?: string } {
  if (config.channel !== "portal_automation") return {};
  return { screenshotUrl: `portal-shot://${encodeURIComponent(orderId)}/${encodeURIComponent(raw).slice(0, 40)}`, scriptVersion: PORTAL_SCRIPT_VERSION };
}

function offerFrom(parsed: z.infer<typeof statusSchema>, fallbackReference: string): ApprovalOffer | undefined {
  if (!parsed.cpt || !parsed.validFrom || !parsed.validTo) return undefined;
  return {
    number: parsed.number || fallbackReference,
    cpt: parsed.cpt,
    validFrom: parsed.validFrom,
    validTo: parsed.validTo,
    units: parsed.units,
    side: parsed.side,
    facility: parsed.facility,
    provider: parsed.provider,
  };
}

function statusFrom(config: InsurerConfig, orderId: string, body: unknown, reference: string): StatusResult {
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) throw new InsurerRefusal("validation", "Response did not match the status schema");
  const raw = JSON.stringify(body);
  return {
    raw,
    normalized: normalizeStatus(config.name, parsed.data.status),
    reference: parsed.data.reference || reference,
    approval: offerFrom(parsed.data, reference),
    phone: parsed.data.phone,
    deadline: parsed.data.deadline,
    items: parsed.data.items ?? parsed.data.detail,
    ...portalArtifacts(config, orderId, parsed.data.status),
  };
}

export function mockAdapter(config: InsurerConfig): InsurerAdapter {
  return {
    insurerId: config.insurerId,
    channel: config.channel,
    async checkEligibility(order) {
      const step = take(order.orderId, "eligibility");
      if (step.op !== "eligibility") throw new InsurerRefusal("unknown", "Bad script");
      return { eligible: step.eligible, raw: step.raw };
    },
    async findExistingApproval(order) {
      const step = take(order.orderId, "existing");
      if (step.op !== "existing") throw new InsurerRefusal("unknown", "Bad script");
      return { approval: step.approval, raw: step.raw };
    },
    async submit(packet) {
      if (config.name === "Ferengi Benefit Group" && packet.criteria.some((item) => item.result === "UNCLEAR")) {
        throw new InsurerRefusal("validation", "Ferengi Benefit Group denies incomplete requests and they cannot be amended");
      }
      const step = take(packet.orderId, "submit");
      if (step.op !== "submit") throw new InsurerRefusal("unknown", "Bad script");
      const body = { reference: step.reference, status: "received", urgent: config.urgent && packet.urgent };
      submissionSchema.parse(body);
      byReference.set(step.reference, { orderId: packet.orderId, insurerId: config.insurerId });
      const result: SubmissionResult = { reference: step.reference, raw: step.raw, ...portalArtifacts(config, packet.orderId, "submit") };
      return result;
    },
    async checkStatus(reference) {
      const owner = byReference.get(reference);
      if (!owner) throw new InsurerRefusal("unknown", `Unknown reference ${reference}`);
      const step = take(owner.orderId, "status-or-error");
      if (step.op === "error") {
        const artifacts = portalArtifacts(config, owner.orderId, step.errorType);
        throw Object.assign(new InsurerRefusal(step.errorType, step.message), artifacts);
      }
      if (step.op !== "status") throw new InsurerRefusal("unknown", "Bad script");
      const body = {
        reference: step.reference ?? reference,
        status: step.raw,
        detail: step.note ?? step.items,
        phone: step.phone,
        deadline: step.deadline,
        items: step.items,
        ...(step.approval
          ? {
              number: step.approval.number,
              cpt: step.approval.cpt,
              validFrom: step.approval.validFrom,
              validTo: step.approval.validTo,
              units: step.approval.units,
              side: step.approval.side,
              facility: step.approval.facility,
              provider: step.approval.provider,
            }
          : {}),
      };
      return statusFrom(config, owner.orderId, body, reference);
    },
    async submitAppeal(packet) {
      const step = take(packet.orderId, "appeal");
      if (step.op !== "appeal") throw new InsurerRefusal("unknown", "Bad script");
      byReference.set(step.reference, { orderId: packet.orderId, insurerId: config.insurerId });
      return { reference: step.reference, raw: step.raw, ...portalArtifacts(config, packet.orderId, "appeal") };
    },
  };
}

export interface ApiTransport {
  post(path: string, body: unknown): Promise<unknown>;
}

/** Real API adapter: request, schema check, reference. Tests pass a fake transport. */
export function apiAdapter(config: InsurerConfig, transport: ApiTransport): InsurerAdapter {
  return {
    insurerId: config.insurerId,
    channel: "api",
    async checkEligibility(order) {
      const body = await transport.post("/eligibility", { orderId: order.orderId });
      return { eligible: true, raw: JSON.stringify(body) };
    },
    async findExistingApproval() {
      return { approval: null, raw: "{}" };
    },
    async submit(packet) {
      const body = await transport.post("/submit", { orderId: packet.orderId, urgent: config.urgent && packet.urgent });
      const parsed = submissionSchema.safeParse(body);
      if (!parsed.success) throw new InsurerRefusal("validation", "Response did not match the submission schema");
      byReference.set(parsed.data.reference, { orderId: packet.orderId, insurerId: config.insurerId });
      return { reference: parsed.data.reference, raw: JSON.stringify(body) };
    },
    async checkStatus(reference) {
      const body = await transport.post("/status", { reference });
      const owner = byReference.get(reference);
      return statusFrom(config, owner?.orderId ?? reference, body, reference);
    },
    async submitAppeal(packet) {
      const body = await transport.post("/appeal", { reference: packet.reference });
      const parsed = submissionSchema.safeParse(body);
      if (!parsed.success) throw new InsurerRefusal("validation", "Response did not match the submission schema");
      return { reference: parsed.data.reference, raw: JSON.stringify(body) };
    },
  };
}

export function portalAdapter(config: InsurerConfig, page: PortalPage, secrets: Secrets = EMPTY_SECRETS): InsurerAdapter {
  const mock = mockAdapter({ ...config, channel: "portal_automation" });
  return {
    ...mock,
    channel: "portal_automation",
    async submit(packet) {
      if (config.mode === "mock") return mock.submit(packet);
      const result = await submitOnPortal(page, secrets, {
        url: "https://portal.local/submit",
        credentialsKey: config.credentialsKey,
        attachments: packet.attachments,
      });
      return {
        reference: result.reference,
        raw: result.raw,
        screenshotUrl: `portal-shot://${packet.orderId}/confirm`,
        scriptVersion: PORTAL_SCRIPT_VERSION,
      };
    },
  };
}

export function adapterFor(config: InsurerConfig, transport?: ApiTransport): InsurerAdapter {
  if (config.channel === "manual" || config.mode === "mock") return mockAdapter(config);
  if (config.channel === "api" && transport) return apiAdapter(config, transport);
  return mockAdapter(config);
}

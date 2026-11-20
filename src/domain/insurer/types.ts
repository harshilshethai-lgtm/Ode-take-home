import type { ApprovalInput, CriterionResultCode } from "@/domain/priorAuth/types";

export type InsurerChannel = "api" | "portal_automation" | "manual";

export type NormalizedStatus =
  | "RECEIVED"
  | "IN_REVIEW"
  | "PENDED"
  | "MORE_INFO_NEEDED"
  | "PEER_TO_PEER_REQUESTED"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "DENIED"
  | "UNKNOWN";

export type InsurerErrorType = "timeout" | "auth_failed" | "captcha" | "page_changed" | "validation" | "http" | "unknown";

export type InteractionKind = "eligibility" | "existing_approval" | "submission" | "status_check" | "appeal_submission";

export interface InsurerError {
  type: InsurerErrorType;
  message: string;
}

export interface ApprovalOffer {
  number: string;
  cpt: string;
  validFrom: string;
  validTo: string;
  side?: string | null;
  units?: number;
  facility?: string | null;
  provider?: string | null;
}

export interface PacketAttachment {
  docId: string;
  name: string;
  pages: number[];
}

export interface CriterionFact {
  id: string;
  label: string;
  result: CriterionResultCode;
  quote?: string;
  page?: number | null;
}

/** What an adapter needs. The pipeline never calls an insurer except through this. */
export interface SubmissionPacket {
  orderId: string;
  insurerId: string;
  urgent: boolean;
  criteria: CriterionFact[];
  attachments: PacketAttachment[];
  cpt: string;
  side: string | null;
  units: number;
  scanDate: string | null;
  policyId: string | null;
}

export interface EligibilityResult {
  eligible: boolean;
  raw: string;
}

export interface ExistingApprovalResult {
  approval: ApprovalOffer | null;
  raw: string;
}

export interface SubmissionResult {
  reference: string;
  raw: string;
  screenshotUrl?: string;
  scriptVersion?: string;
}

export interface StatusResult {
  raw: string;
  normalized: NormalizedStatus;
  reference?: string;
  approval?: ApprovalOffer;
  phone?: string;
  deadline?: string;
  items?: string;
  screenshotUrl?: string;
  scriptVersion?: string;
}

export interface InsurerAdapter {
  insurerId: string;
  channel: InsurerChannel;
  checkEligibility(order: SubmissionPacket): Promise<EligibilityResult>;
  findExistingApproval(order: SubmissionPacket): Promise<ExistingApprovalResult>;
  submit(packet: SubmissionPacket): Promise<SubmissionResult>;
  checkStatus(reference: string): Promise<StatusResult>;
  submitAppeal(appealPacket: SubmissionPacket & { letter: string; reference: string }): Promise<SubmissionResult>;
}

export interface InsurerInteraction {
  id: string;
  orderId: string;
  insurerId: string;
  kind: InteractionKind;
  channel: InsurerChannel;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  outcome: "ok" | "error";
  error?: InsurerError;
  reference?: string;
  rawResponse: string;
  normalized?: NormalizedStatus;
  attachmentsSent?: Array<{ docId: string; pages: number[] }>;
  screenshotUrl?: string;
  scriptVersion?: string;
  actor: "system" | string;
}

export interface TrackedOrder {
  id: string;
  insurerName: string;
  plan: string | null;
  cpt: string;
  side: string | null;
  units: number;
  facility: string | null;
  provider: string | null;
  scanAt: string | null;
  urgent: boolean;
  policyId: string | null;
  policyText: string | null;
  criteria: CriterionFact[];
  attachments: PacketAttachment[];
  /** Tokens stripped before an error is written to any external log. */
  phi: string[];
  appealRound: number;
}

export function toApprovalInput(offer: ApprovalOffer, linked = false): ApprovalInput {
  return {
    number: offer.number,
    cpt: offer.cpt,
    validFrom: offer.validFrom,
    validTo: offer.validTo,
    side: offer.side ?? null,
    units: offer.units ?? 1,
    facility: offer.facility ?? null,
    provider: offer.provider ?? null,
    linked,
  };
}

export class InsurerRefusal extends Error {
  readonly errorType: InsurerErrorType;

  constructor(errorType: InsurerErrorType, message: string) {
    super(message);
    this.name = "InsurerRefusal";
    this.errorType = errorType;
  }
}

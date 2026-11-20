// Flags: the small, fixed vocabulary of alerts shown as icons on the worklist.
// Status says where an order is. Flags say what deserves attention, regardless of status.
// Keep this list short and stable so coordinators learn the icons.

import { fmtCountdown, fmtDuration } from "@/lib/format";
import { INSURER_TURNAROUND_HOURS, hoursUntil, type TimeRisk } from "./timeRisk";

export type FlagId =
  | "safety"
  | "slot_at_risk"
  | "urgent"
  | "rule_violation"
  | "coverage"
  | "missing_docs"
  | "at_risk"
  | "over_sla";

/** Flags that come from the pipeline's findings (stored on the order). The rest are derived from time. */
export type FindingFlagId = Extract<FlagId, "safety" | "rule_violation" | "coverage" | "missing_docs">;

export interface FindingFlag {
  type: FindingFlagId;
  /** Shown on hover. Name the rule or check it came from, e.g. "IMG-330 · Repeat imaging ...". */
  detail: string;
}

export interface Flag {
  id: FlagId;
  detail: string;
}

export type FlagTone = "danger" | "warn";

export const FLAG_DEFS: Record<FlagId, { label: string; meaning: string; tone: FlagTone }> = {
  safety: {
    label: "Patient safety or privacy",
    meaning: "Wrong-patient page, or the side (left/right) disagrees across the record.",
    tone: "danger",
  },
  slot_at_risk: {
    label: "Scan slot at risk",
    meaning: "The insurer can't be expected to answer before the scan, or the scan is within 24 hours.",
    tone: "danger",
  },
  urgent: {
    label: "Urgent order",
    meaning: "Marked urgent by the ordering doctor. Sent with the insurer's urgent flag.",
    tone: "danger",
  },
  rule_violation: {
    label: "Insurer rule not met",
    meaning: "A criterion in the insurer's policy fails. Hover for the rule it came from.",
    tone: "danger",
  },
  coverage: {
    label: "Coverage problem",
    meaning: "Insurer on the order isn't active, or conflicts with the card or a note.",
    tone: "warn",
  },
  missing_docs: {
    label: "Missing or unreadable pages",
    meaning: "A page, document or field is missing, blank or can't be read.",
    tone: "warn",
  },
  at_risk: {
    label: "Scan approaching",
    meaning: "The scan is inside the insurer's usual turnaround plus one day.",
    tone: "warn",
  },
  over_sla: {
    label: "Over status SLA",
    meaning: "The order has sat in its current status longer than that status allows.",
    tone: "warn",
  },
};

/** Most severe first. Controls icon order in the column. */
export const FLAG_ORDER: FlagId[] = [
  "safety",
  "slot_at_risk",
  "urgent",
  "rule_violation",
  "coverage",
  "missing_docs",
  "at_risk",
  "over_sla",
];

export function deriveFlags(args: {
  findings: FindingFlag[];
  risk: TimeRisk;
  priority: "Routine" | "Urgent";
  closed: boolean;
  overSla: { statusLabel: string; minutes: number; slaHours: number } | null;
  scanAt: Date | null;
  insurer: string | null;
  now: Date;
}): Flag[] {
  const { findings, risk, priority, closed, overSla, scanAt, insurer, now } = args;
  const out: Flag[] = findings.map((f) => ({ id: f.type, detail: f.detail }));

  if (closed) return sortFlags(out);

  if (priority === "Urgent") {
    out.push({ id: "urgent", detail: "Urgent order. Send with the insurer's urgent flag." });
  }

  if (scanAt && (risk === "slot_at_risk" || risk === "at_risk")) {
    const when = fmtCountdown(scanAt, now);
    const turnaround = (insurer && INSURER_TURNAROUND_HOURS[insurer]) || 48;
    if (risk === "slot_at_risk") {
      out.push({
        id: "slot_at_risk",
        detail:
          hoursUntil(scanAt, now) <= 24
            ? `Scan ${when} with no approval in hand. Alert scheduling to hold or move the slot.`
            : `Scan ${when}. ${insurer ?? "The insurer"} usually takes ${turnaround}h, so approval may not land in time.`,
      });
    } else {
      out.push({
        id: "at_risk",
        detail: `Scan ${when}. Inside ${insurer ?? "the insurer"}'s ${turnaround}h turnaround plus one day.`,
      });
    }
  }

  if (overSla) {
    out.push({
      id: "over_sla",
      detail: `${overSla.statusLabel} for ${fmtDuration(overSla.minutes)}. SLA for this status is ${overSla.slaHours}h.`,
    });
  }

  return sortFlags(out);
}

export function sortFlags(flags: Flag[]): Flag[] {
  return [...flags].sort((a, b) => FLAG_ORDER.indexOf(a.id) - FLAG_ORDER.indexOf(b.id));
}

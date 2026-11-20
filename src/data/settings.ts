// Configurable modules from PRD §Rule engine, §Handoff after a coordinator fix, §Other configurable modules.

export interface SettingsModule {
  id: string;
  name: string;
  configurable: string;
  defaultValue: string;
  why: string;
}

export const OPERATIONS_MODULES: SettingsModule[] = [
  {
    id: "automation",
    name: "Automation level",
    configurable:
      "Auto-submit on or off per insurer, study and hospital. Shadow mode: the system decides, people still do the work.",
    defaultValue: "Shadow mode for 2 weeks, then auto-submit for API insurers",
    why: "Trust is earned per insurer and per study.",
  },
  {
    id: "confidence",
    name: "Confidence thresholds",
    configurable: "Minimum confidence per field (CPT, side, dates) and per criterion before it counts as Met.",
    defaultValue: "High for side and identity; medium for durations",
    why: "A wrong side is a safety issue; a duration a week off rarely changes the outcome.",
  },
  {
    id: "audit",
    name: "Nurse audit sample",
    configurable: "Share of auto-submitted orders a nurse spot-checks afterwards.",
    defaultValue: "20% in month 1, falling to 5%",
    why: "Measures auto-submit accuracy and catches drift.",
  },
  {
    id: "time-risk",
    name: "Time-risk policy",
    configurable:
      "Each insurer's usual turnaround, when an order turns At risk, when to suggest releasing the slot, and the SLA per status.",
    defaultValue: "At risk when the scan is inside the insurer's turnaround + 1 day",
    why: "Cancelled scans are the real cost.",
  },
  {
    id: "records",
    name: "Outside-records requests",
    configurable: "Template and channel per clinic (fax, Care Everywhere), follow-up timing, when to escalate to a phone call.",
    defaultValue: "Re-request after 24 hours, call after 48",
    why: "22% of packets are missing something.",
  },
  {
    id: "adapters",
    name: "Submission adapters",
    configurable: "Per insurer: API, portal task, or browser automation; retries; receipt check.",
    defaultValue: "API where available; portal as a coordinator task",
    why: "4 of 6 insurers have an API; portals change without notice.",
  },
  {
    id: "tracking",
    name: "Status tracking",
    configurable: "How often each insurer is checked, and by what channel.",
    defaultValue: "API every 4 hours; portal once a day",
    why: "Replaces manual checks on six sites.",
  },
  {
    id: "queues",
    name: "Queue assignment",
    configurable: "Round robin, by hospital, by insurer, or by skill; claim and lock rules.",
    defaultValue: "By hospital, claim to work",
    why: "14 hospitals with local teams.",
  },
  {
    id: "notifications",
    name: "Notifications",
    configurable: "Who gets told what: ordering doctor (In Basket), scheduling, patient; when.",
    defaultValue: "Doctor for side errors and clinical review; scheduling for slot risk",
    why: "Fixes often need the doctor's office.",
  },
  {
    id: "models",
    name: "Models",
    configurable: "Which approved GCP model runs extraction, classification and appeal drafting; prompt versions.",
    defaultValue: "Halcyon's approved models only",
    why: "PHI stays in Halcyon's GCP project.",
  },
];

export interface HandoffMode {
  id: string;
  name: string;
  after: string;
  useWhen: string;
}

export const HANDOFF_MODES: HandoffMode[] = [
  {
    id: "straight",
    name: "Straight to submission",
    after: "Ready to submit, no nurse",
    useWhen: "Default once the pilot shows auto-submit is accurate",
  },
  {
    id: "signoff",
    name: "Nurse sign-off",
    after: "Clinical review, marked \"confirm only\" with the change highlighted",
    useWhen: "Pilot period; high-cost studies; insurers that deny and don't allow amendment",
  },
  {
    id: "if-changed",
    name: "Nurse if anything changed beyond the gap",
    after: "Straight to submission if only the missing item changed and every result is above the confidence threshold; otherwise nurse sign-off",
    useWhen: "Recommended steady state",
  },
];

export const ROUTING_POLICY: { scope: string; example: string }[] = [
  { scope: "Global default", example: "Nurse if anything changed beyond the gap" },
  { scope: "Insurer", example: "Ferengi Benefit Group → nurse sign-off (incomplete requests denied, can't amend)" },
  { scope: "Study type", example: "PET/CT → nurse sign-off" },
  { scope: "Failure type", example: "Wrong-patient page (CO-4) → nurse sign-off; missing page (PP-3) → straight to submission" },
  { scope: "Hospital or department", example: "Pilot site → nurse sign-off for the first 4 weeks" },
];

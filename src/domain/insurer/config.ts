import type { InsurerChannel } from "./types";

export interface InsurerConfig {
  insurerId: string;
  name: string;
  channel: InsurerChannel;
  mode: "mock" | "real";
  /** Federation accepts an urgent flag. Other insurers ignore it. */
  urgent: boolean;
  /** API status cadence, in hours. */
  statusEveryHours: number;
  /** Median hours from submission to an insurer decision. */
  medianDecisionHours: number;
  /** Decision time counts only on business days, and a deadline never lands on a weekend. */
  businessDaysOnly: boolean;
  /** Portal automation checks, local time, business days only. */
  portalTimes: readonly string[];
  /** Business days a pend may sit before it becomes More info requested. */
  pendDays: number;
  appealLevels: number;
  tiesFacility: boolean;
  tiesProvider: boolean;
  /** CPT codes that count as the same family. An exact match always passes. */
  cptFamilies: readonly (readonly string[])[];
  credentialsKey: string;
  /** Backoff after a failed status check, in minutes, one entry per retry. */
  retryMinutes: readonly number[];
}

const api = (name: string, extra: Partial<InsurerConfig> = {}): InsurerConfig => ({
  insurerId: name,
  name,
  channel: "api",
  mode: "mock",
  urgent: false,
  statusEveryHours: 4,
  medianDecisionHours: 48,
  businessDaysOnly: false,
  portalTimes: ["08:00", "14:00"],
  pendDays: 5,
  appealLevels: 2,
  tiesFacility: false,
  tiesProvider: false,
  cptFamilies: [],
  credentialsKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  retryMinutes: [15, 30, 60],
  ...extra,
});

const portal = (name: string, extra: Partial<InsurerConfig> = {}): InsurerConfig =>
  api(name, { channel: "portal_automation", businessDaysOnly: true, ...extra });

/** Real or mock is chosen here, per insurer. The pipeline reads this and never branches on the payer itself. */
export const INSURER_CONFIG: Record<string, InsurerConfig> = {
  "Federation Health": api("Federation Health", { urgent: true, medianDecisionHours: 18, cptFamilies: [["72148", "72149", "72158"]] }),
  "Vulcan Science Mutual": api("Vulcan Science Mutual", { medianDecisionHours: 22 }),
  "Klingon Assurance": api("Klingon Assurance", { medianDecisionHours: 30 }),
  "Bajoran Health Plan": api("Bajoran Health Plan", { medianDecisionHours: 26 }),
  "Ferengi Benefit Group": portal("Ferengi Benefit Group", { appealLevels: 1, medianDecisionHours: 70 }),
  "Andorian Life": portal("Andorian Life", { appealLevels: 2, medianDecisionHours: 40 }),
};

export function businessDaysOnly(name: string | null): boolean {
  if (!name) return false;
  try {
    return configFor(name).businessDaysOnly;
  } catch {
    return false;
  }
}

export function configFor(name: string, override?: Record<string, InsurerConfig>): InsurerConfig {
  const table = override ?? INSURER_CONFIG;
  const found = table[name];
  if (!found) throw new Error(`No insurer config for ${name}`);
  return found;
}

export function withConfig(name: string, patch: Partial<InsurerConfig>): Record<string, InsurerConfig> {
  return { ...INSURER_CONFIG, [name]: { ...configFor(name), ...patch, insurerId: name, name } };
}

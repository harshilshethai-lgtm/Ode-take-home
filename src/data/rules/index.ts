// App-wide instance: localStorage-backed store seeded with the three starter policies, on the prototype's demo clock.

import { SEED_ORDERS } from "@/data/orders";
import type { RulesUser } from "@/domain/rules/types";
import { DEMO_NOW, demoDateKey, nextDemoStamp, resetDemoClock } from "@/lib/demoClock";
import { recordOrderEvaluations } from "./orderEvaluations";
import { buildSeedDb } from "./seed";
import { createRulesApi } from "./service";
import { RulesStore } from "./store";

const demoToday = () => demoDateKey(DEMO_NOW);
const demoNow = () => nextDemoStamp();

export const rulesStore = new RulesStore(typeof localStorage === "undefined" ? null : localStorage, buildSeedDb);
export const rulesApi = createRulesApi(rulesStore, { today: demoToday, now: demoNow });

recordOrderEvaluations(rulesApi, SEED_ORDERS);

/** Restore the rule seed and put audit stamps back on the demo clock. */
export function restoreDemoRules(): void {
  resetDemoClock();
  rulesApi.reset();
  recordOrderEvaluations(rulesApi, SEED_ORDERS);
}

/** Stand-ins until real auth exists. Two roles: editors edit drafts; approvers can also publish under the two-person rule. */
export const RULES_USERS: RulesUser[] = [
  { id: "u_dana", name: "Dana Whitfield", role: "editor" },
  { id: "u_marcus", name: "Marcus Lee", role: "editor" },
  { id: "u_priya", name: "Priya Raman", role: "approver" },
];

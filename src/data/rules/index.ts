// App-wide instance: localStorage-backed store seeded with the three starter policies, on the prototype's demo clock.

import { DEMO_NOW, SEED_ORDERS } from "@/data/orders";
import type { RulesUser } from "@/domain/rules/types";
import { recordOrderEvaluations } from "./orderEvaluations";
import { buildSeedDb } from "./seed";
import { createRulesApi } from "./service";
import { RulesStore } from "./store";

const pad = (n: number) => String(n).padStart(2, "0");
const demoToday = () => `${DEMO_NOW.getFullYear()}-${pad(DEMO_NOW.getMonth() + 1)}-${pad(DEMO_NOW.getDate())}`;

const loadedAt = Date.now();
/** Demo-clock timestamp that still moves forward in real time, so audit entries stay in order. */
const demoNow = () => new Date(DEMO_NOW.getTime() + (Date.now() - loadedAt)).toISOString();

export const rulesStore = new RulesStore(typeof localStorage === "undefined" ? null : localStorage, buildSeedDb);
export const rulesApi = createRulesApi(rulesStore, { today: demoToday, now: demoNow });

recordOrderEvaluations(rulesApi, SEED_ORDERS);

/** Stand-ins until real auth exists. Two roles: editors edit drafts; approvers can also publish under the two-person rule. */
export const RULES_USERS: RulesUser[] = [
  { id: "u_dana", name: "Dana Whitfield", role: "editor" },
  { id: "u_marcus", name: "Marcus Lee", role: "editor" },
  { id: "u_priya", name: "Priya Raman", role: "approver" },
];

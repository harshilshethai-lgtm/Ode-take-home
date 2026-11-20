import { useSyncExternalStore } from "react";
import { rulesApi, rulesStore } from "@/data/rules";
import type { RulesApi } from "@/data/rules/service";

/** Returns the API and re-renders the component whenever the underlying data changes. */
export function useRules(): RulesApi {
  useSyncExternalStore(rulesStore.subscribe, rulesStore.getSnapshot);
  return rulesApi;
}

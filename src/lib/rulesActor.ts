import { useMemo } from "react";
import type { RulesUser } from "@/domain/rules/types";
import { usePersona } from "./persona";

/**
 * Who is editing rules: the signed-in persona. The prototype has no real auth, so everyone may edit and publish
 * (the two-person rule, when on, still compares the publisher with the last editor).
 */
export function useRulesActor(): RulesUser {
  const { me } = usePersona();
  return useMemo(() => ({ id: me.id, name: me.name, role: "approver" as const }), [me.id, me.name]);
}

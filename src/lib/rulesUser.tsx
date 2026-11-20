import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { RULES_USERS } from "@/data/rules";
import type { RulesUser } from "@/domain/rules/types";

const KEY = "halcyon.rules.user.v1";

interface Ctx {
  user: RulesUser;
  setUserId: (id: string) => void;
}

const RulesUserContext = createContext<Ctx | null>(null);

/** Stub for real auth: pick who you are acting as. The role gates publishing when the two-person rule is on. */
export function RulesUserProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(() => localStorage.getItem(KEY) ?? RULES_USERS[0].id);
  useEffect(() => localStorage.setItem(KEY, id), [id]);
  const user = RULES_USERS.find((u) => u.id === id) ?? RULES_USERS[0];
  return <RulesUserContext.Provider value={{ user, setUserId: setId }}>{children}</RulesUserContext.Provider>;
}

const FALLBACK: Ctx = { user: RULES_USERS[0], setUserId: () => {} };

/** Works without the provider too (the legacy rule pages), acting as the first stub user. */
export function useRulesUser(): Ctx {
  return useContext(RulesUserContext) ?? FALLBACK;
}

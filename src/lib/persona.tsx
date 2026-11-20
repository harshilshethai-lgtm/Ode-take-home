import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CURRENT_USER_ID, PEOPLE_BY_ID } from "@/data/people";
import type { Person } from "@/domain/types";

interface PersonaCtx {
  me: Person;
  setMeId: (id: string) => void;
}

const Ctx = createContext<PersonaCtx | null>(null);

/** Who the prototype is "signed in" as. Shared by the shell's switcher and the worklist's "Assign to me". */
export function PersonaProvider({ children }: { children: ReactNode }) {
  const [meId, setMeId] = useState(CURRENT_USER_ID);
  const value = useMemo(() => ({ me: PEOPLE_BY_ID[meId], setMeId }), [meId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePersona(): PersonaCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePersona must be used inside PersonaProvider");
  return v;
}

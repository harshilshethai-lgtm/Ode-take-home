import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SEED_ORDERS } from "@/data/orders";
import { restoreDemoRules } from "@/data/rules";
import type { StatusId } from "@/domain/statuses";
import type { Order } from "@/domain/types";

const KEY = "halcyon.assignments.v1";

type Assignments = Record<string, string | null>;

function load(): Assignments {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Assignments;
  } catch {
    return {};
  }
}

export interface StatusPatch {
  status: StatusId;
  reason: string;
  statusSince: string;
  confirmOnly?: boolean;
  linkedApproval?: boolean;
}

interface OrdersCtx {
  orders: Order[];
  assign: (ids: string[], personId: string | null) => void;
  applyStatus: (id: string, patch: StatusPatch) => void;
  reset: () => void;
}

const Ctx = createContext<OrdersCtx | null>(null);

/** Orders with locally-persisted assignments applied. Shared so the command palette can reset them too. */
export function OrdersProvider({ children }: { children: ReactNode }) {
  const [assignments, setAssignments] = useState<Assignments>(load);
  const [patches, setPatches] = useState<Record<string, StatusPatch>>({});

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(assignments));
  }, [assignments]);

  const orders: Order[] = useMemo(
    () =>
      SEED_ORDERS.map((o) => ({
        ...o,
        ...(o.id in assignments ? { assigneeId: assignments[o.id] } : {}),
        ...patches[o.id],
      })),
    [assignments, patches],
  );

  const assign = useCallback((ids: string[], personId: string | null) => {
    setAssignments((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = personId;
      return next;
    });
  }, []);

  const applyStatus = useCallback((id: string, patch: StatusPatch) => {
    setPatches((prev) => ({ ...prev, [id]: patch }));
  }, []);

  const reset = useCallback(() => {
    setAssignments({});
    setPatches({});
    restoreDemoRules();
  }, []);

  const value = useMemo(() => ({ orders, assign, applyStatus, reset }), [orders, assign, applyStatus, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrders(): OrdersCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrders must be used inside OrdersProvider");
  return v;
}

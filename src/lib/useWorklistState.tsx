import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SEED_ORDERS } from "@/data/orders";
import { restoreDemoRules } from "@/data/rules";
import { PIPELINE_TIMEOUT_MS, planInboundFax, type InboundPatch } from "@/domain/inboundFax";
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

export interface StatusPatch extends Partial<InboundPatch> {
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
  startInboundFax: (orderId: string) => void;
  reset: () => void;
}

const Ctx = createContext<OrdersCtx | null>(null);

/** Orders with locally-persisted assignments applied. Shared so the command palette can reset them too. */
export function OrdersProvider({ children }: { children: ReactNode }) {
  const [assignments, setAssignments] = useState<Assignments>(load);
  const [patches, setPatches] = useState<Record<string, StatusPatch>>({});
  const timers = useRef<number[]>([]);
  const ordersRef = useRef<Order[]>([]);

  const clearTimers = useCallback(() => {
    for (const handle of timers.current) window.clearTimeout(handle);
    timers.current = [];
  }, []);

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
  ordersRef.current = orders;

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

  const startInboundFax = useCallback(
    (orderId: string) => {
      const order = ordersRef.current.find((item) => item.id === orderId);
      if (!order) return;
      clearTimers();
      const plan = planInboundFax(order);
      let elapsed = 0;
      for (const step of plan.steps) {
        elapsed += step.delayMs;
        timers.current.push(window.setTimeout(() => applyStatus(orderId, step.patch), elapsed));
      }
      if (!plan.completes) {
        timers.current.push(window.setTimeout(() => applyStatus(orderId, plan.timeout), elapsed + PIPELINE_TIMEOUT_MS));
      }
    },
    [applyStatus, clearTimers],
  );

  const reset = useCallback(() => {
    clearTimers();
    setAssignments({});
    setPatches({});
    restoreDemoRules();
  }, [clearTimers]);

  const value = useMemo(
    () => ({ orders, assign, applyStatus, startInboundFax, reset }),
    [orders, assign, applyStatus, startInboundFax, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrders(): OrdersCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrders must be used inside OrdersProvider");
  return v;
}

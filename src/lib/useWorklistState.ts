import { useCallback, useEffect, useMemo, useState } from "react";
import { SEED_ORDERS } from "@/data/orders";
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

/** Orders with locally-persisted assignments applied. Assignment is the only mutation on this screen. */
export function useOrders() {
  const [assignments, setAssignments] = useState<Assignments>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(assignments));
  }, [assignments]);

  const orders: Order[] = useMemo(
    () =>
      SEED_ORDERS.map((o) =>
        o.id in assignments ? { ...o, assigneeId: assignments[o.id] } : o,
      ),
    [assignments],
  );

  const assign = useCallback((ids: string[], personId: string | null) => {
    setAssignments((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = personId;
      return next;
    });
  }, []);

  const reset = useCallback(() => setAssignments({}), []);

  return { orders, assign, reset };
}

import { useRules } from "@/lib/useRules";

/** The stored evaluation for a case, and whether a newer rule version now applies to it. */
export function useOrderCheck(orderNumber: string | null | undefined) {
  const api = useRules();
  const evaluation = orderNumber ? api.getLatestEvaluationFor(orderNumber) : null;
  const staleness = evaluation ? api.getStaleness(evaluation.id) : null;
  return {
    evaluation,
    staleness,
    recheck: (actorName: string) => (evaluation ? api.recheckEvaluation(evaluation.id, actorName) : null),
  };
}

// Adding a primitive = one new module + one line here. The engine and the editor UI read only this registry.

import type { Primitive } from "../types";
import { clinicalJudgment } from "./clinicalJudgment";
import { evidenceInWindow } from "./evidenceInWindow";
import { minDuration } from "./minDuration";
import { noPriorStudyInWindow } from "./noPriorStudyInWindow";
import { requiredDocumentation } from "./requiredDocumentation";
import { requiredPriorStudy } from "./requiredPriorStudy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrimitive = Primitive<any>;

const ALL: AnyPrimitive[] = [
  minDuration,
  evidenceInWindow,
  requiredPriorStudy,
  noPriorStudyInWindow,
  requiredDocumentation,
  clinicalJudgment,
];

export const PRIMITIVES: Record<string, AnyPrimitive> = Object.fromEntries(ALL.map((p) => [p.type, p]));

export function getPrimitive(type: string): AnyPrimitive | undefined {
  return PRIMITIVES[type];
}

export function listPrimitives(): AnyPrimitive[] {
  return ALL;
}

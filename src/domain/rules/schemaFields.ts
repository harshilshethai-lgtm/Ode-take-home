// Turns a primitive's Zod params schema into a flat list of form fields, so the editor never needs a
// hand-written form per primitive. Labels and help text come from `.meta({ title, description })`.

import type { ZodType } from "zod";
import { humanize, capitalize } from "./common";

export type FieldKind = "text" | "number" | "boolean" | "select" | "multiselect" | "list";

export interface FieldDef {
  name: string;
  kind: FieldKind;
  label: string;
  help?: string;
  optional: boolean;
  options?: string[];
  integer?: boolean;
}

interface ZodDefLike {
  type: string;
  innerType?: AnySchema;
  element?: AnySchema;
  entries?: Record<string, string>;
  checks?: Array<{ _zod?: { def?: { check?: string } } }>;
}
interface AnySchema {
  _zod: { def: ZodDefLike };
  shape?: Record<string, AnySchema>;
  meta?: () => { title?: string; description?: string } | undefined;
}

function unwrap(schema: AnySchema): { inner: AnySchema; optional: boolean; title?: string; description?: string } {
  let cur = schema;
  let optional = false;
  let title: string | undefined;
  let description: string | undefined;
  for (;;) {
    const m = cur.meta?.();
    title ??= m?.title;
    description ??= m?.description;
    const def = cur._zod.def;
    if ((def.type === "optional" || def.type === "default" || def.type === "nullable") && def.innerType) {
      optional ||= def.type !== "nullable";
      cur = def.innerType;
    } else break;
  }
  return { inner: cur, optional, title, description };
}

export function schemaToFields(schema: ZodType): FieldDef[] {
  const root = schema as unknown as AnySchema;
  const shape = root.shape ?? {};
  return Object.entries(shape).map(([name, raw]) => {
    const { inner, optional, title, description } = unwrap(raw);
    const def = inner._zod.def;
    const base = { name, label: title ?? capitalize(humanize(name)), help: description, optional };
    switch (def.type) {
      case "boolean":
        return { ...base, kind: "boolean" as const };
      case "number":
        return {
          ...base,
          kind: "number" as const,
          integer: def.checks?.some((c) => c._zod?.def?.check === "number_format") ?? false,
        };
      case "enum":
        return { ...base, kind: "select" as const, options: Object.values(def.entries ?? {}) };
      case "array": {
        const el = def.element ? unwrap(def.element).inner._zod.def : undefined;
        if (el?.type === "enum") return { ...base, kind: "multiselect" as const, options: Object.values(el.entries ?? {}) };
        return { ...base, kind: "list" as const };
      }
      default:
        return { ...base, kind: "text" as const };
    }
  });
}

/** Strip empty values so optional fields that were cleared don't fail validation. */
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

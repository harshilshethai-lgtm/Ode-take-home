// Highlight what changed inside a "from → to" pair. Numbers and words are diffed word by word ("4" → "6");
// comma lists (CPT codes, plan types) are diffed item by item so one added code doesn't mark its neighbour.

import { diffWords, type Seg } from "@/domain/rules/diff";

const isList = (s: string) => s.includes(", ");

function items(list: string[], other: string[]): Seg[] {
  return list.map((item, i) => ({ text: item + (i < list.length - 1 ? ", " : ""), kind: other.includes(item) ? ("same" as const) : ("add" as const) }));
}

/** `to` marks inserted text as "add"; `from` marks removed text as "del". */
export function diffInline(from: string, to: string): { from: Seg[]; to: Seg[] } {
  if (isList(from) || isList(to)) {
    const a = from.split(", ");
    const b = to.split(", ");
    return {
      from: items(a, b).map((s) => ({ ...s, kind: s.kind === "add" ? ("del" as const) : s.kind })),
      to: items(b, a),
    };
  }
  const d = diffWords(from, to);
  return { from: d.before, to: d.after };
}

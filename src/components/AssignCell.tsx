import { Bot } from "lucide-react";
import { PEOPLE } from "@/data/people";
import type { OwnerRole } from "@/domain/statuses";
import type { Person } from "@/domain/types";

export function eligiblePeople(role: OwnerRole): Person[] {
  if (role === "coordinator") return PEOPLE.filter((p) => p.role === "coordinator");
  if (role === "nurse" || role === "rules_admin") return PEOPLE.filter((p) => p.role === "nurse");
  return [];
}

interface Props {
  role: OwnerRole;
  assigneeId: string | null;
  me: Person;
  closed: boolean;
  onAssign: (personId: string | null) => void;
}

/** Owner: "System" for automated work, otherwise one dropdown. You appear in the list as "(me)". */
export function AssignCell({ role, assigneeId, me, closed, onAssign }: Props) {
  if (role === "system" || closed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
        <Bot size={14} /> System
      </span>
    );
  }

  const unassigned = assigneeId === null;

  return (
    <select
      aria-label="Assign owner"
      value={assigneeId ?? ""}
      onChange={(e) => onAssign(e.target.value || null)}
      className={`w-[170px] cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-slate-200 hover:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 ${
        unassigned ? "text-slate-400" : "text-slate-800"
      }`}
    >
      <option value="">Unassigned</option>
      {eligiblePeople(role).map((p) => (
        <option key={p.id} value={p.id}>
          {p.id === me.id ? `${p.name} (me)` : p.name}
        </option>
      ))}
    </select>
  );
}

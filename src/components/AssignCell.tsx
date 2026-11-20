import { Bot } from "lucide-react";
import { PEOPLE, PEOPLE_BY_ID } from "@/data/people";
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

export function AssignCell({ role, assigneeId, me, closed, onAssign }: Props) {
  if (role === "system" || closed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Bot size={14} /> System
      </span>
    );
  }

  const people = eligiblePeople(role);
  const unassigned = assigneeId === null;
  const canClaim = unassigned && people.some((p) => p.id === me.id);

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="Assign owner"
        value={assigneeId ?? ""}
        onChange={(e) => onAssign(e.target.value || null)}
        className={`w-full max-w-[176px] rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-300 ${
          unassigned
            ? "border-dashed border-slate-300 bg-white text-slate-500"
            : "border-slate-200 bg-slate-50 font-medium text-slate-800"
        }`}
      >
        <option value="">Unassigned</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {canClaim ? (
        <button
          type="button"
          onClick={() => onAssign(me.id)}
          className="w-fit text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
        >
          Assign to me
        </button>
      ) : assigneeId && PEOPLE_BY_ID[assigneeId]?.id === me.id ? (
        <span className="text-[11px] text-slate-400">Yours</span>
      ) : null}
    </div>
  );
}

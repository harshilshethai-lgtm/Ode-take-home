import { useState } from "react";
import { PEOPLE } from "@/data/people";
import type { OwnerRole } from "@/domain/statuses";
import type { Person } from "@/domain/types";
import { Avatar, BotAvatar } from "@/components/ui/avatar";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function eligiblePeople(role: OwnerRole): Person[] {
  if (role === "coordinator") return PEOPLE.filter((p) => p.role === "coordinator");
  if (role === "nurse" || role === "rules_admin") return PEOPLE.filter((p) => p.role === "nurse");
  return [];
}

export const firstName = (p: Person) => p.name.split(/[ ,]/)[0];

interface Props {
  role: OwnerRole;
  assigneeId: string | null;
  me: Person;
  closed: boolean;
  onAssign: (personId: string | null) => void;
}

/** Owner cell: avatar + first name, "System" with a bot for automated work. Click to reassign. */
export function AssignMenu({ role, assigneeId, me, closed, onAssign }: Props) {
  const [open, setOpen] = useState(false);

  if (role === "system" || closed) {
    return (
      <span className="inline-flex items-center gap-2 text-body text-fg-2">
        <BotAvatar /> System
      </span>
    );
  }

  const assignee = PEOPLE.find((p) => p.id === assigneeId) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="-ml-1 inline-flex h-7 items-center gap-2 rounded-md px-1 text-body hover:bg-chip"
        >
          {assignee ? (
            <>
              <Avatar name={assignee.name} />
              <span className="text-fg">{firstName(assignee)}</span>
            </>
          ) : (
            <span className="text-fg-3">Unassigned</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()}>
        <MenuItem
          selected={!assignee}
          onClick={() => {
            onAssign(null);
            setOpen(false);
          }}
        >
          Unassigned
        </MenuItem>
        {eligiblePeople(role).map((p) => (
          <MenuItem
            key={p.id}
            selected={p.id === assigneeId}
            onClick={() => {
              onAssign(p.id);
              setOpen(false);
            }}
          >
            <Avatar name={p.name} />
            {p.name}
            {p.id === me.id && <span className="ml-auto text-caption text-fg-3">me</span>}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

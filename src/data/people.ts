import type { Person } from "@/domain/types";

export const PEOPLE: Person[] = [
  { id: "p-jasmine", name: "Jasmine Reyes", role: "coordinator" },
  { id: "p-marcus", name: "Marcus Hale", role: "coordinator" },
  { id: "p-dana", name: "Dana Whitfield", role: "coordinator" },
  { id: "p-priya", name: "Priya Nair, RN", role: "nurse" },
  { id: "p-tom", name: "Tom Eddings, RN", role: "nurse" },
];

export const PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

/** The signed-in user for the prototype's "Assign to me" shortcut. */
export const CURRENT_USER_ID = "p-jasmine";

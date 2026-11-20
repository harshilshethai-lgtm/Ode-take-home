import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";

/** Initials in a circle. Avatars and status dots are the only pill-shaped things in the UI. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-chip text-caption font-medium text-chip-fg",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function BotAvatar() {
  return (
    <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-chip text-chip-fg">
      <Bot size={14} />
    </span>
  );
}

import { HoverCard as H } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const HoverCard = H.Root;
export const HoverCardTrigger = H.Trigger;

/** Detail that belongs one hover away. Same surface as a menu: hairline, shadow-sm. */
export function HoverCardContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof H.Content>) {
  return (
    <H.Portal>
      <H.Content
        sideOffset={sideOffset}
        className={cn("z-50 w-72 rounded-lg border border-line bg-panel p-3 text-body text-fg shadow-sm", className)}
        {...props}
      />
    </H.Portal>
  );
}

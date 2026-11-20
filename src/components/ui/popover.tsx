import { Popover as P } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "start", sideOffset = 4, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 min-w-40 rounded-lg border border-line bg-panel p-1 text-body text-fg shadow-sm", className)}
        {...props}
      />
    </P.Portal>
  );
}

/** One selectable row inside a popover list (32px). */
export function MenuItem({ className, selected, ...props }: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body hover:bg-hover",
        selected ? "font-medium text-fg" : "text-label",
        className,
      )}
      {...props}
    />
  );
}

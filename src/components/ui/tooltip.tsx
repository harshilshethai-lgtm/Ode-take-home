import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Kbd } from "./kbd";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={300}>{children}</Tooltip.Provider>;
}

interface TipProps {
  /** Tooltip body. Falsy = no tooltip, children render as is. */
  content: ReactNode;
  /** Keyboard shortcut hint shown after the text. */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

/** Wraps any element with a hover tooltip. Tooltips carry the explanations the page itself does not. */
export function Tip({ content, shortcut, side = "top", children }: TipProps) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={4}
          className="z-50 flex max-w-xs items-center gap-2 rounded-md border border-line bg-panel px-2 py-1 text-caption text-fg shadow-sm"
        >
          <span>{content}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

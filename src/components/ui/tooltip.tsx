import { Tooltip as TP } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = TP.Provider;

export function Tooltip({ content, children, side = "bottom" }: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TP.Root>
      <TP.Trigger asChild>{children}</TP.Trigger>
      <TP.Portal>
        <TP.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-panel"
        >
          {content}
        </TP.Content>
      </TP.Portal>
    </TP.Root>
  );
}

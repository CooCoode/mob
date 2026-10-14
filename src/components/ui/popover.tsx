import { Popover as PP } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Popover = PP.Root;
export const PopoverTrigger = PP.Trigger;

export function PopoverContent({ className, sideOffset = 8, ...props }: ComponentProps<typeof PP.Content>) {
  return (
    <PP.Portal>
      <PP.Content
        sideOffset={sideOffset}
        className={cn("z-50 w-80 rounded-xl border bg-popover p-3 shadow-panel outline-none", className)}
        {...props}
      />
    </PP.Portal>
  );
}

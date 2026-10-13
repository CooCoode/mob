import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const content =
  "z-50 min-w-40 overflow-hidden rounded-lg border bg-popover p-1 text-[13px] shadow-panel";
const item =
  "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none " +
  "data-[highlighted]:bg-muted data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuRadioGroup = DM.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} className={cn(content, className)} {...props} />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...props }: ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return <DM.Item className={cn(item, danger && "text-danger [&_svg]:text-danger", className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(item, "pr-7", className)} {...props}>
      {children}
      <DM.ItemIndicator className="absolute right-2">
        <Check className="!text-accent" />
      </DM.ItemIndicator>
    </DM.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 py-1 text-[11px] font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator(props: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className="-mx-1 my-1 h-px bg-border" {...props} />;
}

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(content, className)} {...props} />
    </CM.Portal>
  );
}

export function ContextMenuItem({ className, danger, ...props }: ComponentProps<typeof CM.Item> & { danger?: boolean }) {
  return <CM.Item className={cn(item, danger && "text-danger [&_svg]:text-danger", className)} {...props} />;
}

export function ContextMenuSeparator(props: ComponentProps<typeof CM.Separator>) {
  return <CM.Separator className="-mx-1 my-1 h-px bg-border" {...props} />;
}

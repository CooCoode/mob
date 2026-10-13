import { Tabs as TB } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TB.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TB.List>) {
  return <TB.List className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TB.Trigger>) {
  return (
    <TB.Trigger
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-muted-foreground outline-none " +
          "hover:bg-muted hover:text-foreground data-[state=active]:bg-muted data-[state=active]:font-medium " +
          "data-[state=active]:text-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TB.Content>) {
  return <TB.Content className={cn("min-h-0 flex-1 outline-none", className)} {...props} />;
}

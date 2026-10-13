import { Switch as SW } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SW.Root>) {
  return (
    <SW.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-border transition-colors " +
          "data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SW.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[17px]" />
    </SW.Root>
  );
}

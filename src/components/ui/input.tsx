import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full min-w-0 rounded-md border bg-background px-2.5 text-[13px] outline-none transition-shadow " +
          "placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring/40 " +
          "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("grid gap-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

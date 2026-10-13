import { CircleSlash, X } from "lucide-react";
import type { TaskStatus } from "@/api/types";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-label="Running"
      className={cn("inline-block size-3.5 shrink-0 animate-spin-slow rounded-full border-[1.5px] border-accent border-t-transparent", className)}
    />
  );
}

/** Status language used everywhere: success is silent. */
export function StatusIcon({ status, position, className }: { status: TaskStatus; position?: number; className?: string }) {
  switch (status) {
    case "running":
      return <Spinner className={className} />;
    case "queued":
      return (
        <span
          aria-label={position ? `Queued #${position}` : "Queued"}
          className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground", className)}
        >
          {position ?? "…"}
        </span>
      );
    case "failed":
      return (
        <span aria-label="Failed" className={cn("inline-flex size-3.5 items-center justify-center rounded-full bg-danger text-white", className)}>
          <X className="size-2.5" strokeWidth={3} />
        </span>
      );
    case "cancelled":
      return <CircleSlash aria-label="Cancelled" className={cn("size-3.5 text-muted-foreground", className)} />;
    default:
      return null;
  }
}

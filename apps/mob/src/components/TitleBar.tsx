import { Moon, PanelLeft, PanelRight, RefreshCw, Search, Settings, Sun } from "lucide-react";
import type { Health, Queue } from "@/api/types";
import { ChecksList } from "@/components/settings/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useApp, type Machine } from "@/store/app";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function HealthChip({ machine, health, error, queue, refetch }: {
  machine: Machine;
  health?: Health;
  error: boolean;
  queue?: Queue;
  refetch: () => void;
}) {
  const checks = Object.values(health?.checks ?? {});
  const failing = checks.filter((c) => !c.ok && !c.unknown).length;
  const state = error ? "offline" : !health ? "checking" : failing ? `${failing} issue${failing > 1 ? "s" : ""}` : "ready";
  const dot = error ? "bg-danger" : !health ? "bg-muted-foreground/40" : failing ? "bg-warning" : "bg-success";
  const waiting = queue?.queued.length ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-7 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted">
          <span className={cn("size-2 rounded-full", dot)} />
          <span className="font-medium">{machine.name}</span>
          <span className="text-muted-foreground">{state}</span>
          {waiting > 0 && <span className="rounded-full bg-muted px-1.5 text-[10.5px] text-muted-foreground">queue {waiting}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold">{machine.name}</p>
            <p className="text-[11px] text-muted-foreground">{machine.mobdUrl}{health && ` · API v${health.apiVersion}`}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Recheck" onClick={refetch}><RefreshCw /></Button>
        </div>
        {error && <p className="text-xs text-danger">mobd is unreachable. Check the URL, network/VPN and MOBD_CORS_ORIGINS on the office Mac.</p>}
        {health && !health.checks && <p className="text-xs text-muted-foreground">This mobd does not report readiness checks. Update it to API v3.</p>}
        <ChecksList checks={health?.checks} />
      </PopoverContent>
    </Popover>
  );
}

export function TitleBar(props: {
  machine: Machine | null;
  health?: Health;
  healthError: boolean;
  queue?: Queue;
  refetchHealth: () => void;
  dark: boolean;
}) {
  const { sidebarOpen, previewOpen, theme, set, openSettings } = useApp();
  return (
    <header
      data-tauri-drag-region
      className={cn("flex h-11 shrink-0 select-none items-center gap-1 border-b bg-sidebar pr-2", isTauri ? "pl-[78px]" : "pl-2")}
    >
      <Tooltip content="Toggle sidebar (⌘B)">
        <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => set({ sidebarOpen: !sidebarOpen })}><PanelLeft /></Button>
      </Tooltip>
      <img src="/logo.svg" alt="" draggable={false} data-tauri-drag-region className="ml-1 size-8 shrink-0" />
      <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight">mob</span>
      <div data-tauri-drag-region className="flex flex-1 items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => set({ paletteOpen: true })}
          className="flex h-7 w-64 items-center gap-2 rounded-md border bg-background/70 px-2.5 text-xs text-muted-foreground hover:bg-background"
        >
          <Search className="size-3.5" /> Search or run a command
          <span className="ml-auto flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </button>
        {props.machine && (
          <HealthChip machine={props.machine} health={props.health} error={props.healthError} queue={props.queue} refetch={props.refetchHealth} />
        )}
      </div>
      <Tooltip content={props.dark ? "Light theme" : "Dark theme"}>
        <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => set({ theme: props.dark ? "light" : theme === "light" ? "dark" : "dark" })}>
          {props.dark ? <Sun /> : <Moon />}
        </Button>
      </Tooltip>
      <Tooltip content="Toggle live view (⌘⇧B)">
        <Button variant="ghost" size="icon-sm" aria-label="Toggle live view" onClick={() => set({ previewOpen: !previewOpen })}><PanelRight /></Button>
      </Tooltip>
      <Tooltip content="Settings (⌘,)">
        <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => openSettings()}><Settings /></Button>
      </Tooltip>
    </header>
  );
}

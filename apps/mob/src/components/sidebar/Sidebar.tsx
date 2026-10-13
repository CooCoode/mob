import { useQuery } from "@tanstack/react-query";
import {
  Archive, ArchiveRestore, ChevronRight, Monitor, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings, SquarePen, Star, Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchArchived, supports } from "@/api/client";
import type { Session } from "@/api/types";
import { StatusIcon } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Kbd } from "@/components/ui/kbd";
import { chat, useChat } from "@/hooks/useChat";
import { useHealth, useQueue } from "@/hooks/useMachine";
import { cn, shortAgo } from "@/lib/utils";
import { baseUrl, useApp, type Machine } from "@/store/app";
import { useComposer } from "@/store/composer";

type Action = "rename" | "pin" | "archive" | "unarchive" | "delete";

function SessionActions({ session, admin, onAction, Item, Separator }: {
  session: Session;
  admin: boolean;
  onAction: (a: Action) => void;
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
}) {
  if (!admin) return <Item disabled>Update office mobd to manage sessions</Item>;
  const busy = !!session.activeTaskId;
  return (
    <>
      <Item onSelect={() => onAction("rename")}><Pencil /> Rename</Item>
      {!session.archived && (
        <Item onSelect={() => onAction("pin")}>{session.pinned ? <><PinOff /> Unpin</> : <><Pin /> Pin</>}</Item>
      )}
      {session.archived
        ? <Item onSelect={() => onAction("unarchive")}><ArchiveRestore /> Unarchive</Item>
        : <Item onSelect={() => onAction("archive")}><Archive /> Archive</Item>}
      <Separator />
      <Item danger disabled={busy} onSelect={() => onAction("delete")}><Trash2 /> Delete…</Item>
    </>
  );
}

function SessionRow({ session, active, admin, onOpen, onAction, position }: {
  session: Session;
  active: boolean;
  admin: boolean;
  position?: number;
  onOpen: () => void;
  onAction: (a: Action) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);
  const act = (a: Action) => (a === "rename" ? (setTitle(session.title), setEditing(true)) : onAction(a));
  const commit = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== session.title) void chat.patchSession(session.id, { title: next });
  };
  if (editing) {
    return (
      <input
        ref={field}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label="Session title"
        className="mx-1 h-7 w-[calc(100%-8px)] rounded-md border border-accent bg-background px-2 text-[13px] outline-none"
      />
    );
  }
  const status = session.activeTaskId ? session.status : session.status === "failed" ? "failed" : null;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-current={active ? "true" : undefined}
          onClick={onOpen}
          onKeyDown={(e) => e.key === "Enter" && onOpen()}
          onDoubleClick={() => admin && act("rename")}
          title={session.title}
          className={cn(
            "group relative flex h-8 cursor-default items-center gap-2 rounded-md pl-2.5 pr-1.5 text-[13px] outline-none",
            active ? "bg-foreground/[0.07] font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
          )}
        >
          {session.pinned && <Star className="size-3 shrink-0 fill-warning text-warning" />}
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
          <span className="flex w-7 shrink-0 justify-end group-hover:hidden group-focus-within:hidden">
            {status ? <StatusIcon status={status} position={position} /> : <span className="text-[11px] text-muted-foreground">{shortAgo(session.updatedAt)}</span>}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Session actions"
                onClick={(e) => e.stopPropagation()}
                className="hidden size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex group-focus-within:flex data-[state=open]:flex"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
              <SessionActions session={session} admin={admin} onAction={act} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <SessionActions session={session} admin={admin} onAction={act} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ArchivedGroup({ base, admin, onAction }: { base: string; admin: boolean; onAction: (s: Session, a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const chatState = useChat();
  const { data } = useQuery({
    queryKey: ["archived", base, chatState.sessions.length],
    queryFn: () => fetchArchived(base),
    enabled: open && admin,
  });
  if (!admin) return null;
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /> Archived
      </button>
      {open && (data?.length ? data.map((s) => (
        <SessionRow key={s.id} session={s} active={chatState.sessionId === s.id} admin={admin}
          onOpen={() => void chat.open(s.id)} onAction={(a) => onAction(s, a)} />
      )) : <p className="px-7 py-1 text-xs text-muted-foreground/70">Nothing archived</p>)}
    </div>
  );
}

function MachineGroup({ machine, active }: { machine: Machine; active: boolean }) {
  const chatState = useChat();
  const { selectMachine, collapsed, set } = useApp();
  const base = baseUrl(machine);
  const { data: health, isError } = useHealth(base);
  const admin = supports(health, "sessionAdmin");
  const { data: queue } = useQueue(base, active && supports(health, "queue"));
  const positionOf = (sessionId: string) => queue?.queued.find((t) => t.sessionId === sessionId)?.queuePosition;
  const [confirm, setConfirm] = useState<Session | null>(null);
  const isCollapsed = !!collapsed[machine.id] && active;
  const checksBad = health && Object.values(health.checks ?? {}).some((c) => !c.ok && !c.unknown);
  const dot = isError ? "bg-muted-foreground/40" : !health ? "bg-muted-foreground/30" : checksBad ? "bg-warning" : "bg-success";

  const onAction = (s: Session, a: Action) => {
    if (a === "pin") void chat.patchSession(s.id, { pinned: !s.pinned });
    else if (a === "archive") void chat.patchSession(s.id, { archived: true });
    else if (a === "unarchive") void chat.patchSession(s.id, { archived: false });
    else if (a === "delete") setConfirm(s);
  };

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => (active ? set({ collapsed: { ...collapsed, [machine.id]: !collapsed[machine.id] } }) : selectMachine(machine.id))}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Monitor className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{machine.name}</span>
        <span className={cn("size-1.5 rounded-full", dot)} />
        {active && <ChevronRight className={cn("size-3 transition-transform", !isCollapsed && "rotate-90")} />}
      </button>
      {active && !isCollapsed && (
        <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)] gap-px">
          {chatState.loading && !chatState.sessions.length && (
            <div className="grid gap-1.5 px-2.5 py-1">
              {[70, 55, 80].map((w) => <div key={w} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}
            </div>
          )}
          {chatState.sessions.map((s) => (
            <SessionRow key={s.id} session={s} active={chatState.sessionId === s.id} admin={admin} position={positionOf(s.id)}
              onOpen={() => void chat.open(s.id)} onAction={(a) => onAction(s, a)} />
          ))}
          {chatState.ready && !chatState.sessions.length && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground/70">No conversations yet</p>
          )}
          <ArchivedGroup base={base} admin={admin} onAction={onAction} />
        </div>
      )}
      {!active && <p className="px-7 text-[11px] text-muted-foreground/60">Select to show sessions</p>}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="w-[400px] p-5" showClose={false}>
          <DialogTitle>Delete conversation?</DialogTitle>
          <DialogDescription className="mt-1.5">
            “{confirm?.title}” and its screenshots are removed from the office Mac. This cannot be undone.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { if (confirm) void chat.deleteSession(confirm.id); setConfirm(null); }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Sidebar() {
  const { machines, activeMachineId, openSettings } = useApp();
  const chatState = useChat();
  const focus = useComposer((s) => s.focus);
  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r bg-sidebar">
      <div className="px-2 pb-2 pt-1">
        <Button
          variant="secondary"
          className="w-full justify-start gap-2 bg-background/60"
          disabled={!chatState.ready || chatState.submitting}
          onClick={() => {
            chat.newChat();
            focus();
          }}
        >
          <SquarePen className="size-4" />
          New chat
          <span className="ml-auto flex gap-0.5"><Kbd>⌘</Kbd><Kbd>N</Kbd></span>
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Sessions">
        {machines.map((m) => <MachineGroup key={m.id} machine={m} active={m.id === activeMachineId} />)}
      </nav>
      <div className="flex gap-1 border-t px-2 py-2">
        <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => openSettings("machines", null)}>
          <Settings className="size-3.5" /> Settings
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Add machine" onClick={() => useApp.setState({ settingsOpen: true, settingsTab: "machines", editMachineId: "" })}>
          <Plus />
        </Button>
      </div>
    </aside>
  );
}

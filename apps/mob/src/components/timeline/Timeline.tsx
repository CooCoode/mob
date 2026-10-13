import { ArrowDown, Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { artifactUrl } from "@/api/client";
import type { ChatMessage, Task } from "@/api/types";
import { Spinner, StatusIcon } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { useChat } from "@/hooks/useChat";
import { buildTimeline, type TimelineItem } from "@/lib/timeline";
import { cn, compactNumber, duration } from "@/lib/utils";
import { useComposer } from "@/store/composer";
import { ActivityGroup, ActivityRow } from "./activity";
import { Markdown } from "./Markdown";

const EXAMPLES = [
  { title: "Open a website", prompt: "Open Safari and go to example.com, then tell me the page title." },
  { title: "Check the screen", prompt: "Take a screenshot and describe what is on the office desktop." },
  { title: "Summarize mail", prompt: "Open Mail and summarize the five most recent unread messages." },
  { title: "Write a note", prompt: "Open TextEdit, create a new document and type today's date." },
];

function UserMessage({ message, task, base }: { message: ChatMessage; task?: Task; base: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {!!task?.attachments?.length && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {task.attachments.map((id) => (
            <img key={id} src={artifactUrl(base, id)} alt="Attachment" className="size-16 rounded-lg border object-cover" />
          ))}
        </div>
      )}
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[14px] leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">mob</span>
          <span>Codex</span>
        </div>
        <Markdown text={message.content} />
        <div className="mt-1 flex h-6 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy reply"
            onClick={() => {
              void navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TurnFooter({ task, last }: { task: Task; last: boolean }) {
  const chat = useChat();
  const took = duration(task.startedAt, task.finishedAt);
  const tokens = task.usage ? task.usage.inputTokens + task.usage.outputTokens : 0;
  const meta = [took, tokens ? `${compactNumber(tokens)} tokens` : "", task.model ?? "", task.effort ? `effort ${task.effort}` : ""].filter(Boolean);
  return (
    <div className="grid gap-2 pl-9">
      {task.status === "failed" && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px]">
          <StatusIcon status="failed" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-danger">Turn failed</p>
            {task.error && <p className="mt-0.5 break-words text-muted-foreground">{task.error}</p>}
          </div>
          {last && (
            <Button variant="secondary" size="sm" disabled={!chat.canSend} onClick={() => void chat.submit(task.prompt, { model: task.model, effort: task.effort, attachments: task.attachments })}>
              <RotateCcw /> Retry
            </Button>
          )}
        </div>
      )}
      {task.status === "cancelled" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusIcon status="cancelled" /> Cancelled
        </p>
      )}
      {meta.length > 0 && <p className="text-[11px] text-muted-foreground/80">{meta.join(" · ")}</p>}
    </div>
  );
}

function Item({ item, base, last }: { item: TimelineItem; base: string; last: boolean }) {
  const chat = useChat();
  switch (item.type) {
    case "user":
      return <UserMessage message={item.message} task={item.task} base={base} />;
    case "assistant":
      return <AssistantMessage message={item.message} />;
    case "steps":
      return (
        <div className="-my-1.5 grid grid-cols-[minmax(0,1fr)] gap-0.5 pl-9">
          {item.activities.map((a) => <ActivityRow key={a.id} a={a} base={base} />)}
        </div>
      );
    case "group":
      return <div className="pl-9"><ActivityGroup activities={item.activities} base={base} /></div>;
    case "queued":
      return (
        <div className="ml-9 flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
          <StatusIcon status="queued" position={item.task.queuePosition} />
          <span className="flex-1">
            Waiting for the desktop{item.task.queuePosition ? ` · #${item.task.queuePosition} in queue` : ""}
          </span>
          <Button variant="link" size="sm" className="h-auto px-0" disabled={chat.cancelling} onClick={() => void chat.cancel()}>
            Cancel
          </Button>
        </div>
      );
    case "working":
      return (
        <div className="flex items-center gap-2.5 pl-9 text-[13px] text-muted-foreground">
          <Spinner />
          <span className="shimmer">{chat.cancelling ? "Stopping…" : "Working"}</span>
          {item.latest && <span className="min-w-0 truncate">· {item.latest.title}</span>}
        </div>
      );
    case "footer":
      return <TurnFooter task={item.task} last={last} />;
  }
}

function EmptyState({ machineName }: { machineName: string }) {
  const fill = useComposer((s) => s.fill);
  return (
    <div className="mx-auto flex h-full max-w-[640px] flex-col justify-center px-6 pb-10">
      <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Sparkles className="size-4.5" />
      </div>
      <h2 className="mt-3 text-xl font-semibold tracking-tight">What should mob do on {machineName}?</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">The agent works on the office desktop. Watch it live on the right.</p>
      <div className="mt-6 grid grid-cols-2 gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e.title}
            type="button"
            onClick={() => fill(e.prompt)}
            className="rounded-xl border bg-background p-3 text-left transition-colors hover:bg-panel"
          >
            <p className="text-[13px] font-medium">{e.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Timeline({ machineName }: { machineName: string }) {
  const chat = useChat();
  const base = chat.baseUrl;
  // Chat mutates tasks and messages in place; rebuilding per render is cheap and never stale.
  const items = buildTimeline(chat.tasks, chat.session?.messages ?? [], chat.activities);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const signature = `${chat.sessionId}:${items.length}:${chat.activities.length}:${chat.session?.messages?.at(-1)?.content.length ?? 0}:${chat.currentTask?.status}`;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPinned(true);
    setUnseen(false);
  }, [chat.sessionId]);

  const lastFooter = [...items].reverse().find((i) => i.type === "footer")?.id;
  const empty = !chat.loading && !chat.sessionId && items.length === 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setPinned(atBottom);
          if (atBottom) setUnseen(false);
        }}
      >
        {empty ? (
          <EmptyState machineName={machineName} />
        ) : (
          <div className="mx-auto grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-4 px-6 pb-6 pt-5">
            {chat.loading && items.length === 0 && (
              <div className="grid gap-3 pt-4">
                {[60, 85, 40].map((w) => (
                  <div key={w} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {items.map((item) => (
              <Item key={item.id} item={item} base={base} last={item.id === lastFooter} />
            ))}
            {chat.error && (
              <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">{chat.error}</div>
            )}
          </div>
        )}
      </div>
      {unseen && !pinned && (
        <button
          type="button"
          onClick={() => {
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            setUnseen(false);
          }}
          className={cn("absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-popover px-3 py-1 text-xs shadow-panel")}
        >
          <ArrowDown className="size-3.5" /> New activity
        </button>
      )}
    </div>
  );
}

import { ArrowUp, Brain, ChevronDown, Cpu, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { runnerFor, supports, uploadImage } from "@/api/client";
import type { Health } from "@/api/types";
import { Spinner } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useComposer } from "@/store/composer";

interface Attachment {
  key: string;
  name: string;
  preview: string;
  id?: string;
  error?: string;
}

const MAX_ATTACHMENTS = 10;

function Picker({ icon: Icon, label, value, options, onChange, placeholder }: {
  icon: typeof Cpu;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground" aria-label={label}>
          <Icon className="size-3.5" />
          {value || placeholder}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{placeholder}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o} value={o}>
              {o}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer({ machineId, machineName, health }: { machineId: string; machineName: string; health?: Health }) {
  const chat = useChat();
  const { text, setText, focusTick } = useComposer();
  const prefs = useApp((s) => s.turnPrefs[machineId]) ?? {};
  const setTurnPrefs = useApp((s) => s.setTurnPrefs);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const runner = runnerFor(health, chat.session?.runner);
  const canUpload = supports(health, "uploads") && (runner?.images ?? true);
  const canOptions = supports(health, "taskOptions");
  // Older mobd (no runner list) offers the default runner's models/efforts at the top level.
  const models = runner?.models ?? health?.models ?? [];
  const efforts = runner?.efforts ?? health?.efforts ?? [];
  const uploading = attachments.some((a) => !a.id && !a.error);
  const ready = attachments.filter((a) => a.id);
  const busy = chat.busy;

  useEffect(() => {
    input.current?.focus();
  }, [focusTick, chat.sessionId, machineId]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  function addFiles(files: File[]) {
    if (!canUpload) return;
    const images = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_ATTACHMENTS - attachments.length);
    for (const f of images) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      setAttachments((list) => [...list, { key, name: f.name, preview: URL.createObjectURL(f) }]);
      uploadImage(chat.baseUrl, f)
        .then((u) => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, id: u.id } : a))))
        .catch((err) => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, error: String(err.message ?? err) } : a))));
    }
  }

  async function send() {
    const prompt = text.trim();
    if (!prompt || !chat.canSend || uploading) return;
    const ok = await chat.submit(prompt, {
      // Only send settings the turn's runner offers (prefs may come from another runner).
      model: canOptions && prefs.model && (models.length === 0 || models.includes(prefs.model)) ? prefs.model : undefined,
      effort: canOptions && prefs.effort && efforts.includes(prefs.effort) ? prefs.effort : undefined,
      attachments: ready.map((a) => a.id!),
    });
    if (ok) {
      if (useComposer.getState().text.trim() === prompt) setText("");
      for (const a of attachments) URL.revokeObjectURL(a.preview);
      setAttachments([]);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-4">
      <div
        className={cn(
          "rounded-[14px] border bg-background shadow-panel transition-colors focus-within:border-accent/50",
          dragging && "border-accent bg-accent-soft",
        )}
        onDragOver={(e: DragEvent) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <div key={a.key} className="group relative">
                <img src={a.preview} alt={a.name} className={cn("size-14 rounded-lg border object-cover", (!a.id || a.error) && "opacity-50")} />
                {!a.id && !a.error && <Spinner className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />}
                {a.error && (
                  <Tooltip content={a.error}>
                    <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-danger/90 text-center text-[10px] text-white">failed</span>
                  </Tooltip>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => {
                    URL.revokeObjectURL(a.preview);
                    setAttachments((list) => list.filter((x) => x.key !== a.key));
                  }}
                  className="absolute -right-1.5 -top-1.5 hidden size-4.5 items-center justify-center rounded-full bg-foreground text-background group-hover:flex"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e: ClipboardEvent) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={busy ? "The agent is working… you can draft the next message" : `Ask mob to do something on ${machineName}…`}
          aria-label="Task prompt"
          className="block max-h-60 min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Tooltip content={canUpload ? "Attach images" : "Update office mobd to attach images"} side="top">
            <span>
              <Button variant="ghost" size="icon-sm" aria-label="Attach images" disabled={!canUpload || attachments.length >= MAX_ATTACHMENTS} onClick={() => file.current?.click()}>
                <Paperclip />
              </Button>
            </span>
          </Tooltip>
          {canOptions && (
            <>
              <Picker icon={Cpu} label="Model" placeholder="Default model" value={prefs.model ?? ""} options={models}
                onChange={(model) => setTurnPrefs(machineId, { model })} />
              <Picker icon={Brain} label="Reasoning effort" placeholder="Default effort" value={prefs.effort ?? ""} options={efforts}
                onChange={(effort) => setTurnPrefs(machineId, { effort })} />
            </>
          )}
          <div className="flex-1" />
          {busy ? (
            <Tooltip content="Stop" side="top">
              <Button size="icon" className="size-8 rounded-full" aria-label="Stop" disabled={chat.cancelling} onClick={() => void chat.cancel()}>
                {chat.cancelling ? <Spinner className="border-accent-foreground border-t-transparent" /> : <Square className="size-3 fill-current" />}
              </Button>
            </Tooltip>
          ) : (
            <Button
              size="icon"
              className="size-8 rounded-full"
              aria-label="Send"
              disabled={!text.trim() || !chat.canSend || uploading}
              onClick={() => void send()}
            >
              {chat.submitting ? <Spinner className="border-accent-foreground border-t-transparent" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground/70">
        ↵ send · ⇧↵ new line · the agent controls the office Mac
      </p>
    </div>
  );
}

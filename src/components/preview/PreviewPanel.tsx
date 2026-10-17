import { Eye, Expand, Minimize2, MousePointer2, Power, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { screenUrl, supports } from "@/api/client";
import type { Health, Queue } from "@/api/types";
import { activityIcon } from "@/components/timeline/activity";
import { Spinner, StatusIcon } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuthedImage } from "@/hooks/useAuthedImage";
import { chat, useChat } from "@/hooks/useChat";
import { latestClick, screenGeometry } from "@/lib/timeline";
import { stream, useStream } from "@/lib/stream";
import { cn } from "@/lib/utils";
import { devicePixels } from "@/lib/view";
import { useVnc, vnc } from "@/lib/vnc";
import { baseUrl, useApp, vncPassword, vncUrl, type Machine } from "@/store/app";

/** Content box of an object-fit: contain child inside a container. */
function fitRect(box: DOMRect, ratio: number) {
  if (!ratio || !box.width || !box.height) return null;
  const w = Math.min(box.width, box.height * ratio);
  const h = w / ratio;
  return { left: (box.width - w) / 2, top: (box.height - h) / 2, width: w, height: h };
}

function ClickMarker({ stage, ratio }: { stage: HTMLElement | null; ratio: number }) {
  const chatState = useChat();
  const click = latestClick(chatState.activities);
  const geo = screenGeometry(chatState.activities);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!click) return;
    setShown(click.id);
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
  }, [click?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!click || !geo || shown !== click.id || !stage) return null;
  const rect = fitRect(stage.getBoundingClientRect(), ratio || geo.pointWidth / geo.pointHeight);
  if (!rect) return null;
  const left = rect.left + (click.x / geo.pointWidth) * rect.width;
  const top = rect.top + (click.y / geo.pointHeight) * rect.height;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <span key={click.id} className="absolute size-9 animate-ping-once rounded-full border-2 border-accent" style={{ left, top }} />
      <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" style={{ left, top }} />
    </div>
  );
}

function Snapshot({ base, width, onRatio }: { base: string; width: number; onRatio: (r: number) => void }) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  // As wide as the panel shows it; an unchanged screen costs a 304, not a download.
  const image = useAuthedImage(base, width ? screenUrl(base, devicePixels(width, window.devicePixelRatio)) : null, tick);
  useEffect(() => {
    if (image.error) setState("error");
  }, [image.error]);
  const at = image.at ? new Date(image.at).toLocaleTimeString() : "";
  useEffect(() => {
    // Every few seconds while the panel is open; paused while the window is hidden.
    const t = setInterval(() => document.visibilityState === "visible" && setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <img
        src={image.src}
        alt="Office desktop snapshot"
        className={cn("absolute inset-0 size-full object-contain", state === "error" && "invisible")}
        onLoad={(e) => {
          setState("ok");
          onRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
        }}
        onError={() => setState("error")}
      />
      {state === "error" && (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
          Snapshot unavailable. Check Screen Recording on the office Mac.
        </p>
      )}
      {state === "ok" && (
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90 hover:bg-black/70"
        >
          <RefreshCw className="size-2.5" /> Snapshot · {at}
        </button>
      )}
    </>
  );
}

/** View/Control switch for the full-size live view. */
function ModeSwitch({ control, canControl, onChange }: { control: boolean; canControl: boolean; onChange: (control: boolean) => void }) {
  const item = "flex h-6 items-center gap-1 rounded px-2 text-[11.5px] font-medium transition-colors disabled:opacity-40";
  return (
    <div role="radiogroup" aria-label="Live view mode" className="flex rounded-md bg-white/10 p-0.5">
      <button type="button" role="radio" aria-checked={!control} onClick={() => onChange(false)}
        className={cn(item, !control ? "bg-white/90 text-black" : "text-white/70 hover:text-white")}>
        <Eye className="size-3.5" /> View
      </button>
      <Tooltip content={canControl ? "Send your mouse and keyboard to the office Mac" : "Control is not available on this live view yet"}>
        <span>
          <button type="button" role="radio" aria-checked={control} disabled={!canControl} onClick={() => onChange(true)}
            className={cn(item, control ? "bg-warning text-black" : "text-white/70 hover:text-white")}>
            <MousePointer2 className="size-3.5" /> Control
          </button>
        </span>
      </Tooltip>
    </div>
  );
}

function Steps() {
  const chatState = useChat();
  const task = chatState.currentTask;
  const steps = task ? chatState.activities.filter((a) => a.taskId === task.id && a.kind !== "notice") : [];
  if (!steps.length) return null;
  return (
    <section>
      <h3 className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Steps · this turn</h3>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-px">
        {steps.slice(-30).map((a) => {
          const Icon = activityIcon(a);
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => document.getElementById(`act-${a.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
                className="flex h-6 w-full items-center gap-2 rounded px-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {a.status === "running" ? <Spinner className="size-3" /> : <Icon className={cn("size-3", a.status === "failed" && "text-danger")} />}
                <span className="truncate">{a.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function QueueList({ queue }: { queue?: Queue }) {
  const chatState = useChat();
  const rows = [...(queue?.running ?? []), ...(queue?.queued ?? [])];
  if (!rows.length) return null;
  const title = (sessionId: string) => chatState.sessions.find((s) => s.id === sessionId)?.title ?? "Conversation";
  return (
    <section>
      <h3 className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Desktop queue</h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-px">
        {rows.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => void chat.open(t.sessionId)}
              className="flex h-7 w-full items-center gap-2 rounded px-1 text-left text-xs hover:bg-muted"
            >
              <StatusIcon status={t.status} position={t.queuePosition} />
              <span className="min-w-0 flex-1 truncate">{title(t.sessionId)}</span>
              <span className="text-muted-foreground">{t.status === "running" ? "now" : `#${t.queuePosition}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PreviewPanel({ machine, health, queue }: { machine: Machine; health?: Health; queue?: Queue }) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // mobd with the stream feature serves WebRTC; older ones only the VNC relay (removed in D6).
  const streaming = supports(health, "stream");
  const vncState = useVnc();
  const streamState = useStream();
  const state = streaming ? streamState : vncState;
  const { fullscreen, set } = useApp();
  const chatState = useChat();
  const [ratio, setRatio] = useState(0);
  const [, relayout] = useState(0);
  const connected = state.status === "connected";
  const running = chatState.currentTask?.status === "running";
  const canSnapshot = supports(health, "screen") && !connected;
  const canControl = connected && !streaming; // WebRTC control arrives with D3
  const latest = running ? chatState.activities.filter((a) => a.taskId === chatState.currentTask?.id && a.kind !== "notice").at(-1) : undefined;

  useEffect(() => () => {
    vnc.disconnect();
    stream.disconnect();
  }, [machine.id]);
  // Only the full-size view can control; the thumbnail always just watches.
  useEffect(() => {
    if (!fullscreen) vnc.setControl(false);
  }, [fullscreen]);
  useEffect(() => {
    if (state.width && state.height) setRatio(state.width / state.height);
  }, [state.width, state.height]);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => relayout((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const connect = () => {
    if (streaming) {
      const box = stage.current?.getBoundingClientRect();
      if (!video.current || !box) return;
      void stream.connect(video.current, {
        base: baseUrl(machine), health,
        maxWidth: devicePixels(box.width, window.devicePixelRatio), maxHeight: devicePixels(box.height, window.devicePixelRatio),
      });
    } else if (host.current) {
      void vnc.connect(host.current, {
        base: baseUrl(machine), url: vncUrl(machine), health, password: vncPassword(machine), username: machine.vncUsername,
      });
    }
  };
  // The stream is sized to the view: entering or leaving full screen reconnects at the new size.
  const reconnect = useRef(connect);
  reconnect.current = connect;
  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (wasFullscreen.current === fullscreen) return;
    wasFullscreen.current = fullscreen;
    if (!streaming || stream.state.status !== "connected") return;
    const raf = requestAnimationFrame(() => reconnect.current());
    return () => cancelAnimationFrame(raf);
  }, [fullscreen, streaming]);
  const control = connected && state.control;
  const dot = { idle: "bg-muted-foreground/40", connecting: "bg-warning", connected: "bg-success", error: "bg-danger" }[state.status];

  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l bg-panel"
      aria-label="Office desktop"
    >
      <div
        className={cn("flex flex-col", fullscreen ? "fixed inset-0 z-40 bg-black" : "px-3 pt-3")}
        onDoubleClick={(e) => {
          // While controlling, double-clicks belong to the office Mac.
          if (control || (e.target as HTMLElement).closest("button")) return;
          if (connected || canSnapshot) set({ fullscreen: !fullscreen });
        }}
      >
        <div className={cn("flex h-8 items-center gap-2", fullscreen ? "px-4 text-white/85" : "mb-2")}>
          <span className={cn("size-2 rounded-full", dot)} />
          <span className="text-[13px] font-medium">{fullscreen ? `Live · ${machine.name}` : "Live"}</span>
          {!fullscreen && <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">View only</span>}
          {fullscreen && <ModeSwitch control={control} canControl={canControl} onChange={(on) => vnc.setControl(on)} />}
          {connected && state.width > 0 && (
            <span className={cn("text-[11px]", fullscreen ? "text-white/50" : "text-muted-foreground")}>{state.width}×{state.height}</span>
          )}
          <div className="flex-1" />
          {fullscreen && (
            <span className="mr-2 flex items-center gap-1 text-[11px] text-white/50">
              {control ? <>Keys go to the Mac · switch to View, then <Kbd>Esc</Kbd></> : <><Kbd>Esc</Kbd> to exit</>}
            </span>
          )}
          {!fullscreen && (
            <Tooltip content={canControl ? "Take control (opens full screen)" : connected ? "Control is not available on this live view yet" : "Connect the live view to take control"}>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" aria-label="Take control" disabled={!canControl}
                onClick={() => {
                  set({ fullscreen: true });
                  vnc.setControl(true);
                }}>
                <MousePointer2 className="size-3.5" /> Control
              </Button>
            </Tooltip>
          )}
          <Tooltip content={fullscreen ? "Exit full screen" : "Full screen (double-click)"}>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle full screen" disabled={!connected && !canSnapshot}
              className={fullscreen ? "text-white/80 hover:bg-white/10 hover:text-white" : undefined}
              onClick={() => set({ fullscreen: !fullscreen })}>
              {fullscreen ? <Minimize2 /> : <Expand />}
            </Button>
          </Tooltip>
          <Tooltip content={connected ? "Disconnect live view" : "Connect live view"}>
            <Button variant="ghost" size="icon-sm" aria-label={connected ? "Disconnect" : "Connect"}
              className={cn(connected && "text-success", fullscreen && "hover:bg-white/10")}
              disabled={state.status === "connecting"} onClick={() => (connected ? (streaming ? stream : vnc).disconnect() : connect())}>
              {state.status === "connecting" ? <Spinner /> : <Power />}
            </Button>
          </Tooltip>
        </div>
        <div
          ref={stage}
          className={cn(
            "relative overflow-hidden bg-[#0d0e12]",
            fullscreen ? "min-h-0 flex-1" : "aspect-[16/10] rounded-[10px] border",
            control && "ring-2 ring-inset ring-warning",
          )}
        >
          <div ref={host} className={cn("vnc-host absolute inset-0 flex items-center justify-center", (streaming || !connected) && "invisible")} tabIndex={-1} />
          <video ref={video} muted playsInline autoPlay aria-label="Office desktop, live"
            className={cn("absolute inset-0 size-full object-contain", (!streaming || !connected) && "invisible")} />
          {!connected && canSnapshot && <Snapshot base={chatState.baseUrl} width={stage.current?.clientWidth ?? 0} onRatio={setRatio} />}
          {!connected && !canSnapshot && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-xs text-white/60">{state.status === "error" ? state.detail : "Office desktop is not connected"}</p>
              <Button size="sm" variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/15" onClick={connect}>
                <Power className="size-3.5" /> Connect
              </Button>
            </div>
          )}
          <ClickMarker stage={stage.current} ratio={ratio} />
          {control && running && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-warning px-2.5 py-1 text-[11.5px] font-medium text-black shadow-panel">
              The agent is working on this desktop too — your input can interfere
            </div>
          )}
          {latest && (
            <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] text-white backdrop-blur">
              <Spinner className="size-3 border-white border-t-transparent" />
              <span className="truncate">{latest.title}</span>
            </div>
          )}
        </div>
        {!fullscreen && state.status === "error" && canSnapshot && (
          <p className="mt-1.5 truncate text-[11px] text-danger" title={state.detail}>Live view: {state.detail}</p>
        )}
      </div>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto px-2 pb-3">
        <QueueList queue={queue} />
        <Steps />
      </div>
    </aside>
  );
}

import { ChevronDown, Eye, Expand, Gauge, MousePointer2, Power, RefreshCw, Shrink } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { screenUrl, supports } from "@/api/client";
import type { Health, Queue } from "@/api/types";
import { activityIcon } from "@/components/timeline/activity";
import { Spinner, StatusIcon } from "@/components/StatusIcon";
import { isTauri } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuthedImage } from "@/hooks/useAuthedImage";
import { chat, useChat } from "@/hooks/useChat";
import { latestClick, screenGeometry } from "@/lib/timeline";
import { QUALITIES, readoutText, signalBars, stream, useStream, type Quality } from "@/lib/stream";
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

/** Quality for this machine's live view; picking one reconnects an open view (mobd fixes it per session). */
function QualityMenu({ machine, dark }: { machine: Machine; dark: boolean }) {
  const setLiveQuality = useApp((s) => s.setLiveQuality);
  const value = machine.liveQuality ?? "auto";
  const label = QUALITIES.find((q) => q.value === value)?.label;
  return (
    <DropdownMenu>
      <Tooltip content={`Live view quality: ${label}`}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Live view quality: ${label}`}
            className={cn("h-7 gap-1 px-1.5 text-[11.5px]", dark && "text-white/80 hover:bg-white/10 hover:text-white")}>
            <Gauge className="size-3.5" />
            {/* The panel header is narrow: the icon alone there, the name in full screen. */}
            {dark && <>{label} <ChevronDown className="size-3 opacity-60" /></>}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>Live view quality</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(q) => setLiveQuality(machine.id, q as Quality)}>
          {QUALITIES.map((q) => (
            <DropdownMenuRadioItem key={q.value} value={q.value} className="items-start">
              <span className="grid gap-0.5">
                <span className="font-medium">{q.label}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{q.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Connection quality as three bars, coloured when it degrades. */
function SignalBars({ bars }: { bars: 1 | 2 | 3 }) {
  const on = bars === 3 ? "bg-success" : bars === 2 ? "bg-warning" : "bg-danger";
  return (
    <span className="flex h-3 items-end gap-px" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-[1px]", i <= bars ? on : "bg-white/20")} style={{ height: `${i * 4}px` }} />
      ))}
    </span>
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
  const canControl = connected;
  const live = streaming ? stream : vnc;
  const latest = running ? chatState.activities.filter((a) => a.taskId === chatState.currentTask?.id && a.kind !== "notice").at(-1) : undefined;

  useEffect(() => () => {
    vnc.disconnect();
    stream.disconnect();
  }, [machine.id]);
  // Only the full-size view can control; the thumbnail always just watches.
  useEffect(() => {
    if (!fullscreen) {
      vnc.setControl(false);
      stream.setControl(false);
    }
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

  const opened = useRef({ width: 0, height: 0 });
  const connect = (control = false) => {
    if (streaming) {
      const box = stage.current?.getBoundingClientRect();
      if (!video.current || !box) return;
      opened.current = { width: devicePixels(box.width, window.devicePixelRatio), height: devicePixels(box.height, window.devicePixelRatio) };
      void stream.connect(video.current, {
        base: baseUrl(machine), health,
        maxWidth: opened.current.width, maxHeight: opened.current.height,
        quality: machine.liveQuality ?? "auto", control,
      });
    } else if (host.current) {
      void vnc.connect(host.current, {
        base: baseUrl(machine), url: vncUrl(machine), health, password: vncPassword(machine), username: machine.vncUsername,
      });
    }
  };
  // The stream is sized to the view: expanding, collapsing or resizing the window reconnects at the new size.
  const reconnect = useRef(connect);
  reconnect.current = connect;
  // mobd fixes the profile per session: a new quality reconnects, keeping control if it was on.
  const quality = machine.liveQuality ?? "auto";
  const lastQuality = useRef(quality);
  useEffect(() => {
    if (lastQuality.current === quality) return;
    lastQuality.current = quality;
    if (streaming && stream.state.status === "connected") reconnect.current(stream.state.control);
  }, [quality, streaming]);
  const wasFullscreen = useRef(fullscreen);
  const controlAfterResize = useRef(false);
  useEffect(() => {
    if (wasFullscreen.current === fullscreen) return;
    wasFullscreen.current = fullscreen;
    const control = fullscreen && controlAfterResize.current;
    controlAfterResize.current = false;
    if (!streaming || stream.state.status !== "connected") return;
    const raf = requestAnimationFrame(() => reconnect.current(control));
    return () => cancelAnimationFrame(raf);
  }, [fullscreen, streaming]);
  // mobd cannot resize a running stream; once the window has stopped changing size, reconnect.
  useEffect(() => {
    const el = stage.current;
    if (!el || !streaming) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (stream.state.status !== "connected") return;
        const width = devicePixels(el.clientWidth, window.devicePixelRatio);
        const height = devicePixels(el.clientHeight, window.devicePixelRatio);
        if (width !== opened.current.width || height !== opened.current.height) reconnect.current(stream.state.control);
      }, 600);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [streaming]);
  // Shift-Command-C: expand (connecting if needed) and take control in one step. The View/Control
  // switch in the expanded toolbar is the only other way in; the panel itself only watches.
  const takeControl = () => {
    if (!connected) {
      set({ fullscreen: true });
      requestAnimationFrame(() => reconnect.current(true));
    } else if (fullscreen) {
      live.setControl(true);
    } else {
      if (streaming) controlAfterResize.current = true;
      else vnc.setControl(true);
      set({ fullscreen: true });
    }
  };
  const takeControlRef = useRef(takeControl);
  takeControlRef.current = takeControl;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyC") {
        e.preventDefault();
        takeControlRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Connect requests from the command palette, which has no access to the view.
  const { liveConnect } = useApp();
  useEffect(() => {
    if (!liveConnect) return;
    useApp.getState().set({ liveConnect: 0 });
    reconnect.current();
  }, [liveConnect]);
  const control = connected && state.control;
  const bars = signalBars(streamState.loss, streamState.readout?.rttMs);
  const dot = { idle: "bg-muted-foreground/40", connecting: "bg-warning", connected: "bg-success", error: "bg-danger" }[state.status];

  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l bg-panel"
      aria-label="Office desktop"
    >
      {/* Expanded, the live view fills the app window like a remote desktop app: its toolbar takes the title
          bar row (room for the window buttons, drags the window), the picture everything below. */}
      <div className={cn("flex flex-col", fullscreen ? "fixed inset-0 z-40 bg-black" : "px-3 pt-3")}>
        {fullscreen && (
          <div data-tauri-drag-region
            className={cn("flex h-11 shrink-0 select-none items-center gap-2 border-b border-white/10 bg-[#1b1c21] pr-2 text-white/85", isTauri ? "pl-[78px]" : "pl-3")}>
            <span className={cn("size-2 shrink-0 rounded-full", dot)} />
            <span data-tauri-drag-region className="text-[13px] font-semibold">{machine.name}</span>
            <ModeSwitch control={control} canControl={canControl} onChange={(on) => live.setControl(on)} />
            {connected && streaming && state.width > 0 && (
              <Tooltip content={readoutText(state.width, state.height, streamState.readout)}>
                <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-white/60">
                  <SignalBars bars={bars} />
                  {streamState.readout ? `${streamState.readout.kBps} kB/s` : `${state.width}×${state.height}`}
                </span>
              </Tooltip>
            )}
            {connected && !streaming && state.width > 0 && (
              <span className="text-[11px] tabular-nums text-white/50">{state.width}×{state.height}</span>
            )}
            <div data-tauri-drag-region className="h-full flex-1" />
            <span data-tauri-drag-region className="mr-1 flex items-center gap-1 text-[11px] text-white/45">
              {control ? <>Keys go to the Mac · switch to View, then <Kbd>Esc</Kbd></> : <><Kbd>Esc</Kbd> to collapse</>}
            </span>
            {streaming && <QualityMenu machine={machine} dark />}
            <Tooltip content={connected ? "Disconnect live view" : "Connect live view"}>
              <Button variant="ghost" size="icon-sm" aria-label={connected ? "Disconnect" : "Connect"}
                className={cn("hover:bg-white/10", connected ? "text-success" : "text-white/80")}
                disabled={state.status === "connecting"} onClick={() => (connected ? live.disconnect() : connect())}>
                {state.status === "connecting" ? <Spinner /> : <Power />}
              </Button>
            </Tooltip>
            <Tooltip content="Collapse to the panel">
              <Button variant="ghost" size="icon-sm" aria-label="Collapse live view"
                className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => set({ fullscreen: false })}>
                <Shrink />
              </Button>
            </Tooltip>
          </div>
        )}
        {!fullscreen && (
        <div className="mb-2 flex h-8 items-center gap-2">
          <span className={cn("size-2 rounded-full", dot)} />
          <span className="text-[13px] font-medium">Live</span>
          <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">View only</span>
          {connected && state.width > 0 && !streaming && (
            <span className="text-[11px] tabular-nums text-muted-foreground">{state.width}×{state.height}</span>
          )}
          {connected && state.width > 0 && streaming && (
            <Tooltip content={readoutText(state.width, state.height, streamState.readout)}>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {streamState.readout ? `${streamState.readout.kBps} kB/s` : `${state.width}×${state.height}`}
              </span>
            </Tooltip>
          )}
          <div className="flex-1" />
          {streaming && <QualityMenu machine={machine} dark={false} />}
          {/* Ends like the expanded toolbar: quality, power, then expand/collapse in the corner. */}
          <Tooltip content={connected ? "Disconnect live view" : "Connect live view"}>
            <Button variant="ghost" size="icon-sm" aria-label={connected ? "Disconnect" : "Connect"}
              className={cn(connected && "text-success")}
              disabled={state.status === "connecting"} onClick={() => (connected ? live.disconnect() : connect())}>
              {state.status === "connecting" ? <Spinner /> : <Power />}
            </Button>
          </Tooltip>
          <Tooltip content="Expand in the window (double-click) · ⇧⌘C to take control">
            <Button variant="ghost" size="icon-sm" aria-label="Expand live view" disabled={!connected && !canSnapshot}
              onClick={() => set({ fullscreen: true })}>
              <Expand />
            </Button>
          </Tooltip>
        </div>
        )}
        <div
          ref={stage}
          onDoubleClick={(e) => {
            // While controlling, double-clicks belong to the office Mac.
            if (control || (e.target as HTMLElement).closest("button")) return;
            if (connected || canSnapshot) set({ fullscreen: !fullscreen });
          }}
          className={cn(
            "relative overflow-hidden bg-[#0d0e12]",
            fullscreen ? "min-h-0 flex-1" : "aspect-[16/10] rounded-[10px] border",
            control && "ring-2 ring-inset ring-warning",
          )}
        >
          <div ref={host} className={cn("vnc-host absolute inset-0 flex items-center justify-center", (streaming || !connected) && "invisible")} tabIndex={-1} />
          <video ref={video} muted playsInline autoPlay tabIndex={-1} aria-label="Office desktop, live"
            className={cn("absolute inset-0 size-full object-contain outline-none", (!streaming || !connected) && "invisible", control && "touch-none")} />
          {!connected && canSnapshot && <Snapshot base={chatState.baseUrl} width={stage.current?.clientWidth ?? 0} onRatio={setRatio} />}
          {!connected && !canSnapshot && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-xs text-white/60">{state.status === "error" ? state.detail : "Office desktop is not connected"}</p>
              <Button size="sm" variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/15" onClick={() => connect()}>
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

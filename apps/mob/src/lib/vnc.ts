import { useSyncExternalStore } from "react";

type SvncClient = {
  disconnect: () => void;
  inputMode: "human" | "script" | "mixed";
  canvas?: HTMLCanvasElement;
  desktop?: { width: number; height: number } | null;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

export type VncStatus = "idle" | "connecting" | "connected" | "error";

export interface VncState {
  status: VncStatus;
  detail: string;
  width: number;
  height: number;
  /** Human mouse/keyboard reach the office Mac only while true. */
  control: boolean;
}

// Owns the single svnc connection; the host element is moved, never remounted, between layouts.
// The session is input-capable but starts with inputMode "script", which makes svnc ignore
// human events; control switches to "human" without reconnecting.
class VncController {
  state: VncState = { status: "idle", detail: "", width: 0, height: 0, control: false };
  private client: SvncClient | null = null;
  private listeners = new Set<() => void>();
  private attempt = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private update(patch: Partial<VncState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async connect(host: HTMLElement, url: string, password: string | undefined, username?: string): Promise<void> {
    if (!url) {
      this.update({ status: "error", detail: "Set the VNC WebSocket URL in Settings" });
      return;
    }
    this.disconnect();
    const attempt = ++this.attempt;
    this.update({ status: "connecting", detail: "Connecting…" });
    host.replaceChildren();
    try {
      const mod = await import("@xrdavies/svnc");
      const client = (await mod.SVNCClient.connect(host, {
        // With a user name, macOS Screen Sharing signs in as that user (ARD) instead of showing the login window.
        url, credentials: password ? { username: username || undefined, password } : undefined, viewOnly: false, inputMode: "script",
      })) as unknown as SvncClient;
      if (attempt !== this.attempt) {
        client.disconnect();
        return;
      }
      this.client = client;
      const d = client.desktop;
      this.update({ status: "connected", detail: "", width: d?.width ?? 0, height: d?.height ?? 0, control: false });
      client.on("disconnect", () => {
        if (this.client !== client) return;
        this.client = null;
        this.update({ status: "idle", detail: "Disconnected", control: false });
      });
    } catch (err) {
      if (attempt !== this.attempt) return;
      this.update({ status: "error", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  disconnect(): void {
    this.attempt++;
    const c = this.client;
    this.client = null;
    c?.disconnect();
    if (this.state.status !== "idle") this.update({ status: "idle", detail: "Disconnected", width: 0, height: 0, control: false });
  }

  /** Switches between watching and controlling; only possible while connected. */
  setControl(on: boolean): void {
    const c = this.client;
    const control = on && !!c;
    if (c) c.inputMode = control ? "human" : "script";
    if (control) c?.canvas?.focus({ preventScroll: true });
    else if (c?.canvas && document.activeElement === c.canvas) c.canvas.blur();
    if (control !== this.state.control) this.update({ control });
  }
}

export const vnc = new VncController();

export function useVnc(): VncState {
  return useSyncExternalStore(vnc.subscribe, () => vnc.state);
}

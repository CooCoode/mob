import { useSyncExternalStore } from "react";

type SvncClient = {
  disconnect: () => void;
  desktop?: { width: number; height: number } | null;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

export type VncStatus = "idle" | "connecting" | "connected" | "error";

export interface VncState {
  status: VncStatus;
  detail: string;
  width: number;
  height: number;
}

// Owns the single svnc connection; the host element is moved, never remounted, between layouts.
class VncController {
  state: VncState = { status: "idle", detail: "", width: 0, height: 0 };
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

  async connect(host: HTMLElement, url: string, password: string | undefined, viewOnly: boolean): Promise<void> {
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
        url, credentials: password ? { password } : undefined, viewOnly,
      })) as unknown as SvncClient;
      if (attempt !== this.attempt) {
        client.disconnect();
        return;
      }
      this.client = client;
      const d = client.desktop;
      this.update({ status: "connected", detail: viewOnly ? "View only" : "Input enabled", width: d?.width ?? 0, height: d?.height ?? 0 });
      client.on("disconnect", () => {
        if (this.client !== client) return;
        this.client = null;
        this.update({ status: "idle", detail: "Disconnected" });
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
    if (this.state.status !== "idle") this.update({ status: "idle", detail: "Disconnected", width: 0, height: 0 });
  }
}

export const vnc = new VncController();

export function useVnc(): VncState {
  return useSyncExternalStore(vnc.subscribe, () => vnc.state);
}

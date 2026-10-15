import { useSyncExternalStore } from "react";
import { supports } from "@/api/client";
import type { Health } from "@/api/types";
import { authFetch } from "@/lib/auth";
import { log } from "@/store/log";

const UPDATE_MOBD = "Update mobd on the office Mac to use the live desktop";

export interface VncTarget {
  /** mobd base URL: the ticket request carries its credential. */
  base: string;
  /** mobd's /vnc relay WebSocket. */
  url: string;
  health?: Health;
  password?: string;
  username?: string;
}

// WebView WebSockets cannot send Authorization, so /vnc takes a single-use 30 s ticket.
async function vncTicket(base: string): Promise<string> {
  const res = await authFetch(base, `${base}/vnc/ticket`, { method: "POST" });
  if (res.status === 404 || res.status === 405) throw new Error(UPDATE_MOBD);
  const data = (await res.json().catch(() => ({}))) as { ticket?: unknown; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (typeof data.ticket !== "string" || !data.ticket) throw new Error("Invalid live desktop ticket from mobd.");
  return data.ticket;
}

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

  async connect(host: HTMLElement, target: VncTarget): Promise<void> {
    const { url, password, username } = target;
    if (!url) {
      this.update({ status: "error", detail: "Pair this machine in Settings" });
      return;
    }
    if (target.health && !supports(target.health, "vncTicket")) {
      this.update({ status: "error", detail: UPDATE_MOBD });
      return;
    }
    this.disconnect();
    const attempt = ++this.attempt;
    this.update({ status: "connecting", detail: "Connecting…" });
    host.replaceChildren();
    try {
      const [mod, ticket] = await Promise.all([import("@xrdavies/svnc"), vncTicket(target.base)]);
      if (attempt !== this.attempt) return;
      const client = (await mod.SVNCClient.connect(host, {
        // With a user name, macOS Screen Sharing signs in as that user (ARD) instead of showing the login window.
        url: `${url}?ticket=${encodeURIComponent(ticket)}`, credentials: password ? { username: username || undefined, password } : undefined, viewOnly: false, inputMode: "script",
      })) as unknown as SvncClient;
      if (attempt !== this.attempt) {
        client.disconnect();
        return;
      }
      this.client = client;
      // Diagnostics: shows in Settings → Log whether Control-mode keys leave the App.
      client.canvas?.addEventListener("keydown", (e) => {
        if (this.client === client && this.state.control) log(`key → office: ${e.key} (${e.code})`, "info");
      });
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

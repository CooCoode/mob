import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { relayUrl, uid } from "@/lib/utils";

export interface Machine {
  id: string;
  name: string;
  mobdUrl: string;
  /** macOS user for Screen Sharing sign-in (ARD); empty uses VNC password auth. */
  vncUsername?: string;
  vncPassword?: string;
}

export type Theme = "system" | "light" | "dark";
export type SettingsTab = "machines" | "appearance" | "log" | "about";

// Keyed by machine ID (picked runner) and "<machine>/<runner>" (model, effort).
export interface TurnPrefs {
  runner?: string;
  model?: string;
  effort?: string;
}

interface Persisted {
  machines: Machine[];
  activeMachineId: string | null;
  savedSessions: Record<string, string | null>;
  collapsed: Record<string, boolean>;
  sidebarOpen: boolean;
  previewOpen: boolean;
  theme: Theme;
  turnPrefs: Record<string, TurnPrefs>;
}

interface Ephemeral {
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  editMachineId: string | null;
  paletteOpen: boolean;
  fullscreen: boolean;
}

interface Actions {
  set: (patch: Partial<Persisted & Ephemeral>) => void;
  selectMachine: (id: string) => void;
  saveMachine: (m: Omit<Machine, "id"> & { id?: string }) => string;
  deleteMachine: (id: string) => void;
  rememberSession: (machineId: string, sessionId: string | null) => void;
  setTurnPrefs: (machineId: string, prefs: TurnPrefs) => void;
  openSettings: (tab?: SettingsTab, editMachineId?: string | null) => void;
}

export type AppState = Persisted & Ephemeral & Actions;

export function envDefault(...keys: (keyof ImportMetaEnv)[]): string {
  for (const key of keys) {
    const v = import.meta.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export const defaultMobdUrl = () => envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Seeds state from the v1 client's keys (or env) the first time v2 runs.
function initial(): Persisted {
  let machines = read<Machine[]>("mob.machines");
  if (!Array.isArray(machines) || !machines.length) {
    const legacy = (k: string) => {
      try {
        return localStorage.getItem(k)?.trim() || "";
      } catch {
        return "";
      }
    };
    machines = [{
      id: uid(), name: "Office Mac",
      mobdUrl: legacy("mob.mobdUrl") || defaultMobdUrl(),
    }];
  }
  let active: string | null = null;
  try {
    active = localStorage.getItem("mob.activeMachineId");
  } catch {
    /* storage unavailable */
  }
  const saved = read<Record<string, string | null>>("mob.activeSessionByMachine");
  return {
    machines,
    activeMachineId: machines.some((m) => m.id === active) ? active : machines[0]?.id ?? null,
    savedSessions: saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {},
    collapsed: {},
    sidebarOpen: true,
    previewOpen: true,
    theme: "system",
    turnPrefs: {},
  };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial(),
      settingsOpen: false,
      settingsTab: "machines",
      editMachineId: null,
      paletteOpen: false,
      fullscreen: false,
      set: (patch) => set(patch),
      selectMachine: (id) => set({ activeMachineId: id, fullscreen: false }),
      saveMachine: (m) => {
        const id = m.id || uid();
        const machine: Machine = {
          id, name: m.name.trim(), mobdUrl: m.mobdUrl.trim(),
          vncUsername: m.vncUsername?.trim() || undefined, vncPassword: m.vncPassword || undefined,
        };
        const machines = get().machines.some((x) => x.id === id)
          ? get().machines.map((x) => (x.id === id ? machine : x))
          : [...get().machines, machine];
        set({ machines, activeMachineId: get().activeMachineId ?? id });
        return id;
      },
      deleteMachine: (id) => {
        const machines = get().machines.filter((m) => m.id !== id);
        const savedSessions = { ...get().savedSessions };
        delete savedSessions[id];
        const activeMachineId = get().activeMachineId === id ? machines[0]?.id ?? null : get().activeMachineId;
        set({ machines, savedSessions, activeMachineId });
      },
      rememberSession: (machineId, sessionId) => {
        if (get().savedSessions[machineId] === sessionId) return;
        set({ savedSessions: { ...get().savedSessions, [machineId]: sessionId } });
      },
      setTurnPrefs: (machineId, prefs) =>
        set({ turnPrefs: { ...get().turnPrefs, [machineId]: { ...get().turnPrefs[machineId], ...prefs } } }),
      openSettings: (tab = "machines", editMachineId = null) =>
        set({ settingsOpen: true, settingsTab: tab, editMachineId: editMachineId ?? get().activeMachineId }),
    }),
    {
      name: "mob.app",
      version: 2,
      // v2 drops the custom VNC WebSocket URL: the live view always goes through mobd.
      migrate: (state, version) => {
        const s = state as Persisted;
        if (version < 2 && Array.isArray(s.machines)) {
          s.machines = s.machines.map(({ vncWsUrl: _, ...m }: Machine & { vncWsUrl?: string }) => m);
        }
        return s;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Persisted => ({
        machines: s.machines, activeMachineId: s.activeMachineId, savedSessions: s.savedSessions,
        collapsed: s.collapsed, sidebarOpen: s.sidebarOpen, previewOpen: s.previewOpen, theme: s.theme,
        turnPrefs: s.turnPrefs,
      }),
    },
  ),
);

export function useActiveMachine(): Machine | null {
  return useApp((s) => s.machines.find((m) => m.id === s.activeMachineId) ?? null);
}

export function baseUrl(m: Machine | null | undefined): string {
  return (m?.mobdUrl ?? "").trim().replace(/\/$/, "");
}

/** VNC WebSocket for the live view: mobd's relay at <mobdUrl>/vnc (http→ws, https→wss). */
export function vncUrl(m: Pick<Machine, "mobdUrl"> | null | undefined): string {
  return relayUrl(m?.mobdUrl ?? "");
}

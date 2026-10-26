import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { configureAuth } from "@/lib/auth";
import { deleteSecret, getSecret, loadSecrets, setSecret, tokenAccount } from "@/lib/secrets";
import { uid } from "@/lib/utils";
import { log } from "@/store/log";
import { migrateApp, vncPasswordAccount } from "@/store/migrate";

export interface Machine {
  id: string;
  name: string;
  /** Origin from the pairing link; changes only by pairing again. */
  mobdUrl: string;
  serverId?: string;
  clientId?: string;
  /** No usable credential: never paired, or mobd answered 401. */
  needsPairing?: boolean;
  /** Live view quality; unset means auto. */
  liveQuality?: "auto" | "high" | "low";
  /** The live view last needed mobd's WebSocket here (no UDP path): try it at once next time. */
  liveWebSocket?: boolean;
}

export interface PairResult {
  id?: string;
  name: string;
  mobdUrl: string;
  serverId: string;
  clientId: string;
  token: string;
}

export type Theme = "system" | "light" | "dark";
export type SettingsTab = "machines" | "appearance" | "log" | "about";

// A new chat's choices on this device, until the chat exists: keyed by machine ID (runner) and
// "<machine>/<runner>" (model, effort). In memory only; conversations keep theirs in mobd.
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
  /** Migrated passwords not yet written to the keychain, keyed by account. */
  legacySecrets: Record<string, string>;
}

interface Ephemeral {
  turnPrefs: Record<string, TurnPrefs>;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  editMachineId: string | null;
  /** An agent of the edited machine to bring into view ("" for its Agents section). */
  settingsFocus: string | null;
  paletteOpen: boolean;
  fullscreen: boolean;
  /** Set to ask the desktop panel to connect the live view (from the command palette). */
  liveConnect: number;
}

interface Actions {
  set: (patch: Partial<Persisted & Ephemeral>) => void;
  selectMachine: (id: string) => void;
  /** Shows or hides the desktop panel; hiding it also leaves full screen. */
  togglePreview: (open?: boolean) => void;
  /** Renames a paired machine. */
  saveMachine: (m: { id: string; name: string }) => void;
  /** Live view quality from the view itself; "auto" clears it. */
  setLiveQuality: (id: string, quality: NonNullable<Machine["liveQuality"]>) => void;
  /** Remembers which transport the live view ended up on. */
  setLiveWebSocket: (id: string, ws: boolean) => void;
  /** Stores the new credential, then creates or updates the machine with the paired address. */
  completePairing: (p: PairResult) => Promise<string>;
  markNeedsPairing: (id: string) => void;
  deleteMachine: (id: string) => void;
  rememberSession: (machineId: string, sessionId: string | null) => void;
  setTurnPrefs: (key: string, prefs: TurnPrefs) => void;
  clearTurnPrefs: (key: string) => void;
  openSettings: (tab?: SettingsTab, editMachineId?: string | null, focus?: string | null) => void;
}

export type AppState = Persisted & Ephemeral & Actions;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Seeds state from the v1 client's keys the first time v2+ runs. Those machines still need pairing.
function initial(): Persisted {
  // No machine is made up: a fresh install starts empty and adds one from a mobd link.
  let machines = read<(Machine & { vncPassword?: string; vncUsername?: string })[]>("mob.machines");
  if (!Array.isArray(machines)) machines = [];
  // VNC is gone: the v1 Desktop sign-in fields are dropped, not moved to the keychain.
  const extracted = { machines: machines.map(({ vncPassword: _p, vncUsername: _u, ...m }) => ({ ...m, needsPairing: true })), legacySecrets: {} };
  let active: string | null = null;
  try {
    active = localStorage.getItem("mob.activeMachineId");
  } catch {
    /* storage unavailable */
  }
  const saved = read<Record<string, string | null>>("mob.activeSessionByMachine");
  return {
    machines: extracted.machines,
    legacySecrets: extracted.legacySecrets,
    activeMachineId: machines.some((m) => m.id === active) ? active : machines[0]?.id ?? null,
    savedSessions: saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {},
    collapsed: {},
    sidebarOpen: true,
    previewOpen: false,
    theme: "system",
  };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial(),
      turnPrefs: {},
      settingsOpen: false,
      settingsTab: "machines",
      editMachineId: null,
      settingsFocus: null,
      paletteOpen: false,
      fullscreen: false,
      liveConnect: 0,
      set: (patch) => set(patch),
      selectMachine: (id) => set({ activeMachineId: id, fullscreen: false }),
      togglePreview: (open = !get().previewOpen) => set(open ? { previewOpen: true } : { previewOpen: false, fullscreen: false }),
      saveMachine: (m) =>
        set({
          machines: get().machines.map((x) =>
            x.id === m.id
              ? { ...x, name: m.name.trim() }
              : x),
        }),
      setLiveQuality: (id, quality) =>
        set({ machines: get().machines.map((x) => (x.id === id ? { ...x, liveQuality: quality === "auto" ? undefined : quality } : x)) }),
      setLiveWebSocket: (id, ws) =>
        set({ machines: get().machines.map((x) => (x.id === id ? { ...x, liveWebSocket: ws || undefined } : x)) }),
      completePairing: async (p) => {
        const id = p.id || uid();
        // The keychain write comes first: the address and its credential change together.
        await setSecret(tokenAccount(id), p.token);
        const previous = get().machines.find((x) => x.id === id);
        const machine: Machine = {
          ...previous, id, name: p.name.trim(), mobdUrl: p.mobdUrl, serverId: p.serverId, clientId: p.clientId, needsPairing: false,
        };
        const machines = previous ? get().machines.map((x) => (x.id === id ? machine : x)) : [...get().machines, machine];
        set({ machines, activeMachineId: get().activeMachineId ?? id });
        return id;
      },
      markNeedsPairing: (id) => {
        const machine = get().machines.find((m) => m.id === id);
        if (!machine || machine.needsPairing) return;
        log(`${id}: mobd rejected the credential; pairing needed`, "error");
        set({ machines: get().machines.map((m) => (m.id === id ? { ...m, needsPairing: true } : m)) });
      },
      deleteMachine: (id) => {
        deleteSecret(tokenAccount(id)).catch((err) => log(`keychain delete failed: ${String(err)}`, "error"));
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
      clearTurnPrefs: (key) => {
        const { [key]: _, ...rest } = get().turnPrefs;
        set({ turnPrefs: rest });
      },
      openSettings: (tab = "machines", editMachineId = null, focus = null) =>
        set({ settingsOpen: true, settingsTab: tab, editMachineId: editMachineId ?? get().activeMachineId, settingsFocus: focus }),
    }),
    {
      name: "mob.app",
      version: 6,
      migrate: (state, version) => {
        if (version < 5) removedVncPasswords = true;
        return migrateApp(state, version) as Persisted;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Persisted => ({
        machines: s.machines, activeMachineId: s.activeMachineId, savedSessions: s.savedSessions,
        collapsed: s.collapsed, sidebarOpen: s.sidebarOpen, previewOpen: s.previewOpen, theme: s.theme,
        legacySecrets: s.legacySecrets,
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

/** Set by the v5 migration: the Desktop sign-in passwords in the keychain are deleted at load. */
let removedVncPasswords = false;

/**
 * Loads every machine's secrets into memory before the first request, writes migrated passwords
 * to the keychain, and marks machines without a credential as needing pairing.
 */
export async function loadMachineSecrets(): Promise<void> {
  const { machines } = useApp.getState();
  const failed = await loadSecrets(machines.map((m) => tokenAccount(m.id)));
  for (const account of failed) log(`keychain read failed: ${account}`, "error");
  if (removedVncPasswords) {
    removedVncPasswords = false;
    for (const m of machines) {
      deleteSecret(vncPasswordAccount(m.id)).catch((err) => log(`keychain delete failed: ${String(err)}`, "error"));
    }
  }
  for (const [account, value] of Object.entries(useApp.getState().legacySecrets ?? {})) {
    try {
      await setSecret(account, value);
      const { [account]: _, ...rest } = useApp.getState().legacySecrets;
      useApp.setState({ legacySecrets: rest });
    } catch (err) {
      log(`keychain write failed for ${account}: ${String(err)}`, "error");
    }
  }
  useApp.setState({
    machines: useApp.getState().machines.map((m) =>
      !m.needsPairing && !getSecret(tokenAccount(m.id)) && !failed.includes(tokenAccount(m.id)) ? { ...m, needsPairing: true } : m),
  });
}


const machinesAt = (base: string) => useApp.getState().machines.filter((m) => baseUrl(m) === base);

configureAuth({
  // An unpaired machine sends nothing: never an old credential to a changed address.
  token: (base) => {
    const m = machinesAt(base).find((x) => !x.needsPairing);
    return m && getSecret(tokenAccount(m.id));
  },
  unauthorized: (base) => {
    for (const m of machinesAt(base)) useApp.getState().markNeedsPairing(m.id);
  },
});

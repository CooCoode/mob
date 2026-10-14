import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

type Phase = "idle" | "disabled" | "checking" | "available" | "current" | "installing" | "installed" | "error";
interface UpdateState {
  phase: Phase;
  currentVersion: string;
  update: Update | null;
  downloaded: number;
  total: number | undefined;
  error: string;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdates = create<UpdateState>()((set, get) => ({
  phase: "idle", currentVersion: "", update: null, downloaded: 0, total: undefined, error: "",
  check: async () => {
    if (!isTauri() || ["checking", "installing", "installed"].includes(get().phase)) return;
    set({ phase: "checking", error: "" });
    try {
      await get().update?.close();
      set({ update: null });
      const currentVersion = await getVersion();
      set({ currentVersion });
      if (!await invoke<boolean>("updater_configured")) {
        set({ phase: "disabled", update: null });
        return;
      }
      const update = await check({ timeout: 15_000 });
      set({ currentVersion, update, phase: update ? "available" : "current" });
    } catch (error) {
      set({ phase: "error", error: String(error) });
    }
  },
  install: async () => {
    const { update, phase } = get();
    if (!update || phase !== "available") return;
    set({ phase: "installing", downloaded: 0, total: undefined, error: "" });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") set({ total: event.data.contentLength });
        if (event.event === "Progress") set({ downloaded: get().downloaded + event.data.chunkLength });
      }, { timeout: 120_000 });
    } catch (error) {
      set({ phase: "error", error: String(error) });
      return;
    }
    set({ phase: "installed" });
    try {
      await relaunch();
    } catch (error) {
      set({ error: `Update installed. Quit and reopen mob to finish. ${String(error)}` });
    }
  },
}));

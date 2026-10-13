import { create } from "zustand";

export type LogKind = "info" | "error" | "event";

export interface LogLine {
  id: number;
  at: string;
  kind: LogKind;
  text: string;
}

const MAX = 2000;
let seq = 0;

interface LogState {
  lines: LogLine[];
  add: (text: string, kind?: LogKind) => void;
  clear: () => void;
}

export const useLog = create<LogState>()((set) => ({
  lines: [],
  add: (text, kind = "event") =>
    set((s) => {
      const lines = [...s.lines, { id: ++seq, at: new Date().toLocaleTimeString(), kind, text }];
      return { lines: lines.length > MAX ? lines.slice(lines.length - MAX) : lines };
    }),
  clear: () => set({ lines: [] }),
}));

export const log = (text: string, kind?: LogKind) => useLog.getState().add(text, kind);

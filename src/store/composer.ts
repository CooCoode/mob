import { create } from "zustand";

interface ComposerState {
  text: string;
  focusTick: number;
  setText: (text: string) => void;
  /** Fills the composer (e.g. from an example prompt) and focuses it. */
  fill: (text: string) => void;
  focus: () => void;
}

export const useComposer = create<ComposerState>()((set) => ({
  text: "",
  focusTick: 0,
  setText: (text) => set({ text }),
  fill: (text) => set((s) => ({ text, focusTick: s.focusTick + 1 })),
  focus: () => set((s) => ({ focusTick: s.focusTick + 1 })),
}));

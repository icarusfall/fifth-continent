// The Zustand store wraps the pure sim. All mutation happens by queueing
// Actions and calling step(), which funnels everything through tick().
// The store also owns the action log — a full game is (seed, actionLog),
// so the log is saved alongside the state and replays are always possible.

import { create } from 'zustand';
import { initialState, tick } from '../sim/tick';
import type { Action, ActionLog, GameState } from '../sim/types';

// v3: GameState gained rent (rentDueTick/rentPaid/lost); older saves are incompatible.
const SAVE_KEY = 'fifth-continent-save-v3';
const AUTOSAVE_EVERY_TICKS = 30;

interface SaveFile {
  version: 1;
  state: GameState;
  actionLog: ActionLog;
}

export interface GameStore {
  state: GameState;
  actionLog: ActionLog;
  pending: Action[];
  paused: boolean;
  /** Ticks per real second while unpaused. */
  ticksPerSecond: number;

  enqueue: (action: Action) => void;
  step: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (ticksPerSecond: number) => void;
  save: () => void;
  reset: () => void;
}

function loadSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed.version !== 1 || typeof parsed.state?.tick !== 'number') return null;
    if (!('farm' in parsed.state) || typeof parsed.state.fleeceReady !== 'number') return null;
    if (!('rentDueTick' in parsed.state) || typeof parsed.state.lost !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSave(state: GameState, actionLog: ActionLog): void {
  try {
    const file: SaveFile = { version: 1, state, actionLog };
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
  } catch {
    // Storage full or unavailable: the game plays on, unsaved.
  }
}

const DEFAULT_SEED = 1740;

export const useGameStore = create<GameStore>()((set, get) => {
  const saved = loadSave();
  return {
    state: saved?.state ?? initialState(DEFAULT_SEED),
    actionLog: saved?.actionLog ?? {},
    pending: [],
    paused: false,
    ticksPerSecond: 3,

    enqueue: (action) => set((s) => ({ pending: [...s.pending, action] })),

    step: () => {
      const { state, pending, actionLog } = get();
      const nextLog =
        pending.length > 0 ? { ...actionLog, [state.tick]: pending } : actionLog;
      const next = tick(state, pending);
      set({ state: next, pending: [], actionLog: nextLog });
      if (next.tick % AUTOSAVE_EVERY_TICKS === 0) writeSave(next, nextLog);
    },

    setPaused: (paused) => set({ paused }),
    setSpeed: (ticksPerSecond) => set({ ticksPerSecond }),

    save: () => {
      const { state, actionLog } = get();
      writeSave(state, actionLog);
    },

    reset: () => {
      localStorage.removeItem(SAVE_KEY);
      set({
        state: initialState(DEFAULT_SEED),
        actionLog: {},
        pending: [],
        paused: false,
      });
    },
  };
});

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = useGameStore;
}


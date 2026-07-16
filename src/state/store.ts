// The Zustand store wraps the pure sim. All mutation happens by queueing
// Actions and calling step(), which funnels everything through tick().
// The store also owns the action log — a full game is (seed, actionLog),
// so the log is saved alongside the state and replays are always possible.

import { create } from 'zustand';
import { RENT_AMOUNT, SHEEP_VALUE } from '../sim/balance';
import { initialState, tick } from '../sim/tick';
import type { Action, ActionLog, GameState } from '../sim/types';

// v9: rent is now player-settled (rentPending) for the event card (§6.8/§6.13).
// v8: M4c adds the garrison, Standing, and the informer to GameState (§6.13).
// v7: M4b adds per-building fortifications to GameState (spec §6.12).
// v6: M3 adds Heat, the Revenue, the ledger, and carters to GameState.
// Older saves are incompatible and are silently abandoned.
const SAVE_KEY = 'fifth-continent-save-v9';
const AUTOSAVE_EVERY_TICKS = 30;
const AUTOPAY_KEY = 'fifth-continent-autopay-rent'; // a UI preference, not game state

/**
 * A centre-screen event card (spec §6.13). The sim stays pure and knows nothing
 * of this; the store watches for card-worthy state changes, pauses, and raises
 * one. 'rent' asks for an active click to pay; 'info' just says its piece.
 */
export interface EventCard {
  id: string;
  kind: 'rent' | 'info';
  title: string;
  body: string;
}

/** The rent-day card, its warning shaped by what the purse can meet (§6.8). */
function rentCard(next: GameState): EventCard {
  const held = Math.min(next.coin, RENT_AMOUNT);
  const short = RENT_AMOUNT - held;
  const body =
    short <= 0
      ? `The agent is at the door for his ${RENT_AMOUNT} coin, and the purse holds it.`
      : `The agent wants ${RENT_AMOUNT} coin; the purse holds ${next.coin}. Short by ${short} — his men will drive off ${Math.ceil(short / SHEEP_VALUE)} sheep for the rest.`;
  return { id: `rent-${next.rentDueTick}`, kind: 'rent', title: 'Rent day', body };
}

function loadAutoPay(): boolean {
  try {
    return localStorage.getItem(AUTOPAY_KEY) === '1';
  } catch {
    return false;
  }
}

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
  /** A pending event card freezes the world until the player answers it (§6.13). */
  activeCard: EventCard | null;
  /** The player has chosen to pay future rents without being asked (§6.8). */
  autoPayRent: boolean;

  enqueue: (action: Action) => void;
  step: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (ticksPerSecond: number) => void;
  /** Settle the rent from the card and dismiss it. */
  payRent: () => void;
  /** Remember to pay future rents automatically (dismisses the ask thereafter). */
  setAutoPayRent: (on: boolean) => void;
  /** Dismiss an informational card and let the world run on. */
  dismissCard: () => void;
  save: () => void;
  reset: () => void;
}

function loadSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed.version !== 1 || typeof parsed.state?.tick !== 'number') return null;
    if (typeof parsed.state.farm?.x !== 'number' || typeof parsed.state.fleeceReady !== 'number')
      return null;
    if (typeof parsed.state.rentDueTick !== 'number' || typeof parsed.state.lost !== 'boolean')
      return null;
    if (typeof parsed.state.dutchman?.present !== 'boolean' || !parsed.state.demandRemaining)
      return null;
    if (
      typeof parsed.state.heat?.regional !== 'number' ||
      typeof parsed.state.revenue?.officer?.arrived !== 'boolean' ||
      typeof parsed.state.ledger?.declaredYield !== 'number'
    )
      return null;
    if (!parsed.state.fortifications || typeof parsed.state.fortifications !== 'object') return null;
    if (!parsed.state.garrisons || typeof parsed.state.standing !== 'number') return null;
    if (typeof parsed.state.rentPending !== 'boolean') return null;
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
    activeCard: null,
    autoPayRent: loadAutoPay(),

    enqueue: (action) => set((s) => ({ pending: [...s.pending, action] })),

    step: () => {
      const { state, pending, actionLog, autoPayRent, activeCard } = get();
      if (activeCard) return; // the world is frozen behind a card until it is answered
      const nextLog =
        pending.length > 0 ? { ...actionLog, [state.tick]: pending } : actionLog;
      const next = tick(state, pending);

      // Event cards (§6.13): rent is the first card-worthy moment. Raise it for
      // an active click, unless the player has opted into paying automatically.
      const rentJustDue = next.rentPending && !state.rentPending;
      if (rentJustDue && !autoPayRent) {
        set({ state: next, pending: [], actionLog: nextLog, activeCard: rentCard(next) });
      } else if (rentJustDue) {
        set({ state: next, pending: [{ type: 'payRent' }], actionLog: nextLog });
      } else {
        set({ state: next, pending: [], actionLog: nextLog });
      }
      if (next.tick % AUTOSAVE_EVERY_TICKS === 0) writeSave(next, nextLog);
    },

    setPaused: (paused) => set({ paused }),
    setSpeed: (ticksPerSecond) => set({ ticksPerSecond }),

    payRent: () => set((s) => ({ pending: [...s.pending, { type: 'payRent' }], activeCard: null })),

    setAutoPayRent: (on) => {
      try {
        localStorage.setItem(AUTOPAY_KEY, on ? '1' : '0');
      } catch {
        // a lost preference is no catastrophe; the ask simply returns
      }
      set({ autoPayRent: on });
    },

    dismissCard: () => set({ activeCard: null }),

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
        activeCard: null,
      });
    },
  };
});

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = useGameStore;
}


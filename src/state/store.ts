// The Zustand store wraps the pure sim. All mutation happens by queueing
// Actions and calling step(), which funnels everything through tick().
// The store also owns the action log — a full game is (seed, actionLog),
// so the log is saved alongside the state and replays are always possible.

import { create } from 'zustand';
import {
  CART_CAPACITY,
  CART_COST,
  MAX_CARTS,
  RENT_AMOUNT,
  SHEEP_VALUE,
  TICKS_PER_DAY,
} from '../sim/balance';
import { simulateBattle } from '../sim/combat';
import type { BattleSetup, Call, CombatLog, ScheduledCall } from '../sim/combat';
import { nodeById } from '../sim/map';
import { raidBattleSetup } from '../sim/raid';
import { initialState, tick } from '../sim/tick';
import type { Action, ActionLog, GameState, NodeId } from '../sim/types';

// v10: M4c-2 adds contrabandSold, the Hawksmere record, and the raid (§6.13).
// v9: rent is now player-settled (rentPending) for the event card (§6.8/§6.13).
// v8: M4c adds the garrison, Standing, and the informer to GameState (§6.13).
// v7: M4b adds per-building fortifications to GameState (spec §6.12).
// v6: M3 adds Heat, the Revenue, the ledger, and carters to GameState.
// Older saves are incompatible and are silently abandoned.
const SAVE_KEY = 'fifth-continent-save-v10';
const AUTOSAVE_EVERY_TICKS = 30;
const AUTOPAY_KEY = 'fifth-continent-autopay-rent'; // a UI preference, not game state

/**
 * A centre-screen event card (spec §6.13). The sim stays pure and knows nothing
 * of this; the store watches for card-worthy state changes, pauses, and raises
 * one. 'rent' asks for an active click to pay; 'info' just says its piece.
 */
export interface EventCard {
  id: string;
  kind: 'rent' | 'info' | 'raid';
  title: string;
  body: string;
}

/** A battle being watched (spec §14). The store re-runs the deterministic sim
 *  each time a Call is sounded; the frame log plays back at COMBAT_FRAME_MS. */
export interface BattlePlayback {
  setup: BattleSetup;
  log: CombatLog;
  frame: number;
  calls: ScheduledCall[];
  callsLeft: number;
  target: NodeId;
  targetName: string;
}

/** How long each combat frame is shown — a battle runs ~5–7 seconds (§14). */
export const COMBAT_FRAME_MS = 150;
/** The three Calls per battle (§14.4). */
export const MAX_CALLS = 3;

function battleResultCard(b: BattlePlayback): EventCard {
  const c = b.log.consequences;
  const retreated = b.calls.some((q) => q.call === 'soundRetreat');
  let title: string;
  let body: string;
  if (b.log.outcome === 'paid_off') {
    title = 'Bought off';
    body = `You pay the Company off at ${b.targetName} for ${c.payOffCost} coin. They ride away — this time. The goods stay.`;
  } else if (b.log.playerWon) {
    title = 'The wall holds';
    body = `They break at ${b.targetName} and fall back. ${c.friendlyDead} of your men lie still; the goods are safe.`;
  } else if (retreated) {
    title = 'You pull them out';
    body = `You sound the retreat at ${b.targetName}. The goods are lost, but your people live — only ${c.friendlyDead} did not come home.`;
  } else {
    title = 'Overrun';
    body = `${b.targetName} is taken and the goods carried off. ${c.friendlyDead} of your men are lost, and the parish grieves.`;
  }
  return { id: `result-${b.setup.attacker.strength}-${b.frame}`, kind: 'info', title, body };
}

/** The muster warning (spec §6.13): a Company force is riding for a building. */
function musterCard(next: GameState): EventCard {
  const r = next.raid!;
  const name = nodeById(r.target, next.farm, next.cuttingHouse).name;
  const days = Math.max(1, Math.round((r.battleTick - next.tick) / TICKS_PER_DAY));
  return {
    id: `muster-${r.battleTick}`,
    kind: 'info',
    title: 'A muster gathers',
    body: `The Hawksmere Company is riding for ${name} — the blow falls in about ${days} day${days === 1 ? '' : 's'}. Post men and dig in, or lose the goods.`,
  };
}

/** The blow itself (spec §6.13): the raiders are at the wall, and it must be answered. */
function raidCard(next: GameState): EventCard {
  const r = next.raid!;
  const name = nodeById(r.target, next.farm, next.cuttingHouse).name;
  const g = next.garrisons[r.target];
  const men = (g?.militia ?? 0) + (g?.crew ?? 0);
  const defence = men > 0 ? `${men} of your men hold the wall` : 'and no one holds the wall';
  return {
    id: `raid-${r.battleTick}`,
    kind: 'raid',
    title: 'The Company is at the gate',
    body: `${r.size} of the Hawksmere Company fall on ${name}, ${defence}.`,
  };
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

// ---- Milestone cards (spec §6.13 / §10) --------------------------------------
// Punchy one-shot notices when something new opens up. Each fires the first
// time its condition holds; a persisted "seen" latch keeps it from repeating.

const SHOWN_KEY = 'fifth-continent-shown-cards';
type Shown = Record<string, true>;

function loadShown(): Shown {
  try {
    return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '{}') as Shown;
  } catch {
    return {};
  }
}

function saveShown(shown: Shown): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // a lost latch only risks showing a card twice — no catastrophe
  }
}

function clearShown(): void {
  try {
    localStorage.removeItem(SHOWN_KEY);
  } catch {
    /* ignore */
  }
}

function hasOverproofJenever(s: GameState): boolean {
  return (
    s.carts.some((c) => (c.cargo.jenever ?? 0) > 0) ||
    Object.values(s.stores).some((st) => (st.jenever ?? 0) > 0)
  );
}

interface Milestone {
  key: string;
  when: (s: GameState) => boolean;
  title: string;
  body: string;
}

// Order is priority when several come true at once — the pause sequences them.
const MILESTONES: Milestone[] = [
  {
    key: 'dutchman-offshore',
    when: (s) => s.dutchman.present,
    title: 'A light on the water',
    body: 'A lugger stands off the shingle — no lights, no flag, a falling tide. He pays four times Ryne’s price for wool, and asks nothing. Run a cartload down to the beach while the tide falls.',
  },
  {
    key: 'cutting-house',
    when: (s) => !s.cuttingHouse && hasOverproofJenever(s),
    title: 'Spirit no one will buy',
    body: 'You are holding overproof jenever, and no honest buyer will touch a drop. Raise a cutting house on the marsh: cut it with water and burnt sugar and it sells in Ryne as brandy.',
  },
  {
    key: 'carter-for-hire',
    when: (s) => s.dutchman.unlocked || s.ledger.soldLawfully >= 2 * CART_CAPACITY,
    title: 'Hands for hire',
    body: 'You have walked the wool round enough to feel it. A carter will take the reins for 3 coin a day — hire one at a cart and free your own hands for other work.',
  },
  {
    key: 'second-cart',
    when: (s) => s.carts.length < MAX_CARTS && s.coin >= CART_COST && s.dutchman.unlocked,
    title: 'Room in the yard',
    body: 'There is coin enough for a second cart and pony now, and the yard holds three. More wheels move more at once — buy one at the farm.',
  },
  {
    key: 'officer-arrived',
    when: (s) => s.revenue.officer.arrived,
    title: 'The blue coat',
    body: 'A Riding Officer has taken rooms above the Customs House. He counts your sheep against the books and seizes what your cover cannot hide. Keep the stains moving, and mind the coat on the road.',
  },
];

/** The first milestone whose moment has come and has not yet been shown. */
function detectMilestone(s: GameState, shown: Shown): Milestone | null {
  for (const m of MILESTONES) if (!shown[m.key] && m.when(s)) return m;
  return null;
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
  /** Milestone cards already shown, so each punchy notice fires only once. */
  shownCards: Shown;
  /** A raid being watched frame by frame (spec §14). Freezes the world too. */
  battle: BattlePlayback | null;

  enqueue: (action: Action) => void;
  step: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (ticksPerSecond: number) => void;
  /** Settle the rent from the card and dismiss it. */
  payRent: () => void;
  /** Begin watching the pending raid (§14) — the card gives way to the battle. */
  startBattle: () => void;
  /** Advance the playback one frame; ends the battle at the last frame. */
  advanceBattleFrame: () => void;
  /** Sound one of the three Calls (§14.4) — re-runs the sim from this frame on. */
  soundCall: (call: Call) => void;
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
    if (!parsed.state.hawksmere || typeof parsed.state.contrabandSold !== 'number') return null;
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
  if (!saved) clearShown(); // a fresh game meets its milestones anew
  return {
    state: saved?.state ?? initialState(DEFAULT_SEED),
    actionLog: saved?.actionLog ?? {},
    pending: [],
    paused: false,
    ticksPerSecond: 3,
    activeCard: null,
    autoPayRent: loadAutoPay(),
    shownCards: saved ? loadShown() : {},
    battle: null,

    enqueue: (action) => set((s) => ({ pending: [...s.pending, action] })),

    step: () => {
      const { state, pending, actionLog, autoPayRent, activeCard, shownCards, battle } = get();
      if (activeCard || battle) return; // the world is frozen behind a card or a battle
      const nextLog =
        pending.length > 0 ? { ...actionLog, [state.tick]: pending } : actionLog;
      const next = tick(state, pending);

      // Event cards (§6.13). Rent is the one that asks for a click; a milestone
      // is a punchy notice when something new opens up (§10). Rent takes the
      // slot when it and a milestone come at once — the pause sequences the rest.
      const rentJustDue = next.rentPending && !state.rentPending;
      let nextPending: Action[] = [];
      let card: EventCard | null = null;
      let shown = shownCards;

      // Raid beats (§6.13): the muster gathering, then the blow at the wall.
      const musterGathered = !!next.raid && !state.raid;
      const battlePending = !!next.raid?.pendingBattle && !state.raid?.pendingBattle;

      if (rentJustDue && !autoPayRent) {
        card = rentCard(next);
      } else if (rentJustDue) {
        nextPending = [{ type: 'payRent' }];
      } else if (battlePending) {
        card = raidCard(next);
      } else if (musterGathered) {
        card = musterCard(next);
      } else {
        const m = detectMilestone(next, shownCards);
        if (m) {
          card = { id: m.key, kind: 'info', title: m.title, body: m.body };
          shown = { ...shownCards, [m.key]: true };
          saveShown(shown);
        }
      }

      set({ state: next, pending: nextPending, actionLog: nextLog, activeCard: card, shownCards: shown });
      if (next.tick % AUTOSAVE_EVERY_TICKS === 0) writeSave(next, nextLog);
    },

    setPaused: (paused) => set({ paused }),
    setSpeed: (ticksPerSecond) => set({ ticksPerSecond }),

    payRent: () => set((s) => ({ pending: [...s.pending, { type: 'payRent' }], activeCard: null })),

    startBattle: () => {
      const s = get().state;
      const setup = raidBattleSetup(s);
      if (!setup || !s.raid) {
        set({ activeCard: null });
        return;
      }
      set({
        activeCard: null,
        battle: {
          setup,
          log: simulateBattle(setup),
          frame: 0,
          calls: [],
          callsLeft: MAX_CALLS,
          target: s.raid.target,
          targetName: nodeById(s.raid.target, s.farm, s.cuttingHouse).name,
        },
      });
    },

    advanceBattleFrame: () => {
      const b = get().battle;
      if (!b) return;
      if (b.frame >= b.log.frames.length - 1) {
        // The battle is watched out; settle it (the sim re-runs the same Calls,
        // so the world agrees with what the player just saw) and show the result.
        set((state) => ({
          pending: [...state.pending, { type: 'resolveRaid', calls: b.calls }],
          battle: null,
          activeCard: battleResultCard(b),
        }));
        return;
      }
      set({ battle: { ...b, frame: b.frame + 1 } });
    },

    soundCall: (call) => {
      const b = get().battle;
      if (!b || b.callsLeft <= 0) return;
      const calls = [...b.calls, { frame: b.frame, call }];
      const log = simulateBattle({ ...b.setup, calls });
      set({
        battle: { ...b, log, calls, callsLeft: b.callsLeft - 1, frame: Math.min(b.frame, log.frames.length - 1) },
      });
    },

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
      clearShown(); // a new tenancy meets its milestones fresh
      set({
        state: initialState(DEFAULT_SEED),
        actionLog: {},
        pending: [],
        paused: false,
        activeCard: null,
        shownCards: {},
        battle: null,
      });
    },
  };
});

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = useGameStore;
}


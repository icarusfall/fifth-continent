// UI-only state (the clean-sheet pass): overlay mode, open panels, the phone
// dock. None of this is game state — nothing here touches the sim or the save
// (house rules 1–2), and losing it costs a preference, never a tenancy.

import { create } from 'zustand';
import type { GameState } from '../sim/types';

/**
 * §20.2 — the overlays, one control. A = yours (goods, ribbons, waterways);
 * B = theirs (the gossip map, the Revenue's mind as the parish tells it);
 * C = both superimposed. The gap between A and B is the game.
 */
export type OverlayMode = 'off' | 'a' | 'b' | 'c';

/** B exists only once there is a Revenue mind to gossip about (§6.10/§10). */
export function gossipAvailable(state: GameState): boolean {
  return state.heat.regional >= 0.5 || state.revenue.officer.arrived;
}

interface UiStore {
  /** §20.2 — default A: what you are doing, on by default since the hub. */
  overlay: OverlayMode;
  cycleOverlay: (hasGossip: boolean) => void;
  setOverlay: (mode: OverlayMode) => void;
  /** The instrument strip's detail fold. */
  hudOpen: boolean;
  setHudOpen: (open: boolean) => void;
  /** §20.1 — the ledger; lifted here so the bottom bar and the spine tab
   *  drive the same panel. */
  ledgerOpen: boolean;
  setLedgerOpen: (open: boolean) => void;
  /** The full log, phone presentation (the ticker opens it). */
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  /** §20 (stage 3) — which menu groups stand open. Session-only preference:
   *  a long menu folds to its headings and remembers what you kept out. */
  groupOpen: Record<string, boolean>;
  toggleGroup: (id: string) => void;
  /**
   * §10 (the first morning) — a request from chrome OUTSIDE the map (the
   * ticker's pointing sentence) to focus and open a place. GameMap consumes
   * it and clears it; nothing else reads it.
   */
  focusRequest: string | null;
  requestFocus: (sel: string) => void;
  clearFocus: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  overlay: 'a',
  cycleOverlay: (hasGossip) =>
    set((s) => {
      // off → a → b → c → off; before the parish has anything to say, B and
      // C do not exist and the cycle is off → a → off (§10 — no menu names
      // the Revenue before the coast has met it).
      const ring: OverlayMode[] = hasGossip ? ['off', 'a', 'b', 'c'] : ['off', 'a'];
      const at = ring.indexOf(s.overlay);
      return { overlay: ring[(at + 1) % ring.length] ?? 'a' };
    }),
  setOverlay: (mode) => set({ overlay: mode }),
  hudOpen: false,
  setHudOpen: (open) => set({ hudOpen: open }),
  ledgerOpen: false,
  setLedgerOpen: (open) => set({ ledgerOpen: open }),
  logOpen: false,
  setLogOpen: (open) => set({ logOpen: open }),
  groupOpen: {},
  toggleGroup: (id) => set((s) => ({ groupOpen: { ...s.groupOpen, [id]: !(s.groupOpen[id] ?? true) } })),
  focusRequest: null,
  requestFocus: (sel) => set({ focusRequest: sel }),
  clearFocus: () => set({ focusRequest: null }),
}));

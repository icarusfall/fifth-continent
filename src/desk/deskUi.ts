// The desk's own UI state (spec §20.4): what is selected, placement mode, the
// dispatch slips, which explanations are unfolded — and, from D2, cart
// command's working memory: the journeys being driven hop by hop, the round
// being drafted, the route under the pointer, and whether the world leans in.
// Never GameState, never the save (house rules 1–2): a reload costs only this.

import { create } from 'zustand';
import type { Good, NodeId } from '../sim/types';
import type { Route } from './routes';
import type { DeskSelection } from './sheet';

export interface Slip {
  id: string;
  title: string;
  body: string;
  born: number;
}

/** A multi-road send, driven one dispatch at a time as the cart arrives. */
export interface Journey {
  to: NodeId;
  route: Route;
  /** Index of the next leg to issue. */
  next: number;
  /** The tick the last dispatch was issued at: one order per tick, never two. */
  issuedTick: number;
}

/** A round being written by shift-click. `takes` holds the player's overrides
 *  of each stop's default pick-up ('none' = explicitly nothing). */
export interface Draft {
  cartId: string;
  stops: NodeId[];
  takes: Record<number, Good | 'none'>;
}

interface DeskUi {
  selection: DeskSelection | null;
  /** Bumped when something asks the map to ease onto the selection. */
  focusNonce: number;
  placing: boolean;
  slips: Slip[];
  whyOpen: Record<string, boolean>;
  journeys: Record<string, Journey>;
  draft: Draft | null;
  hoverRoute: { cartId: string; route: Route } | null;
  /** The pointer rests on a moving cart: the clock drops to a crawl. */
  leaning: boolean;
  select: (sel: DeskSelection | null, focus?: boolean) => void;
  setPlacing: (on: boolean) => void;
  pushSlip: (slip: Omit<Slip, 'born'>) => void;
  dropSlip: (id: string) => void;
  toggleWhy: (key: string) => void;
  setJourney: (cartId: string, journey: Journey | null) => void;
  setDraft: (draft: Draft | null) => void;
  setHoverRoute: (h: { cartId: string; route: Route } | null) => void;
  setLeaning: (on: boolean) => void;
}

const MAX_SLIPS = 4;

export const useDeskUi = create<DeskUi>()((set) => ({
  selection: null,
  focusNonce: 0,
  placing: false,
  slips: [],
  whyOpen: {},
  journeys: {},
  draft: null,
  hoverRoute: null,
  leaning: false,
  select: (selection, focus = false) =>
    set((s) => ({
      selection,
      placing: false,
      hoverRoute: null,
      // A draft belongs to its cart: selecting anything else puts it down.
      draft: s.draft && selection?.kind === 'cart' && selection.id === s.draft.cartId ? s.draft : null,
      focusNonce: focus ? s.focusNonce + 1 : s.focusNonce,
    })),
  setPlacing: (placing) => set({ placing }),
  pushSlip: (slip) =>
    set((s) =>
      s.slips.some((x) => x.id === slip.id)
        ? s
        : { slips: [{ ...slip, born: Date.now() }, ...s.slips].slice(0, MAX_SLIPS) },
    ),
  dropSlip: (id) => set((s) => ({ slips: s.slips.filter((x) => x.id !== id) })),
  toggleWhy: (key) => set((s) => ({ whyOpen: { ...s.whyOpen, [key]: !s.whyOpen[key] } })),
  setJourney: (cartId, journey) =>
    set((s) => {
      const journeys = { ...s.journeys };
      if (journey) journeys[cartId] = journey;
      else delete journeys[cartId];
      return { journeys };
    }),
  setDraft: (draft) => set({ draft }),
  setHoverRoute: (hoverRoute) => set({ hoverRoute }),
  setLeaning: (leaning) => set((s) => (s.leaning === leaning ? s : { leaning })),
}));

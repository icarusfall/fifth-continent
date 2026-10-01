// The desk's own UI state (spec §20.4): what is selected, placement mode, the
// dispatch slips, and which explanations are unfolded. Never GameState, never
// the save (house rules 1–2): losing it costs a preference, not a tenancy.

import { create } from 'zustand';
import type { DeskSelection } from './sheet';

export interface Slip {
  id: string;
  title: string;
  body: string;
  born: number;
}

interface DeskUi {
  selection: DeskSelection | null;
  /** Bumped when something asks the map to ease onto the selection. */
  focusNonce: number;
  placing: boolean;
  slips: Slip[];
  whyOpen: Record<string, boolean>;
  select: (sel: DeskSelection | null, focus?: boolean) => void;
  setPlacing: (on: boolean) => void;
  pushSlip: (slip: Omit<Slip, 'born'>) => void;
  dropSlip: (id: string) => void;
  toggleWhy: (key: string) => void;
}

const MAX_SLIPS = 4;

export const useDeskUi = create<DeskUi>()((set) => ({
  selection: null,
  focusNonce: 0,
  placing: false,
  slips: [],
  whyOpen: {},
  select: (selection, focus = false) =>
    set((s) => ({ selection, placing: false, focusNonce: focus ? s.focusNonce + 1 : s.focusNonce })),
  setPlacing: (placing) => set({ placing }),
  pushSlip: (slip) =>
    set((s) =>
      s.slips.some((x) => x.id === slip.id)
        ? s
        : { slips: [{ ...slip, born: Date.now() }, ...s.slips].slice(0, MAX_SLIPS) },
    ),
  dropSlip: (id) => set((s) => ({ slips: s.slips.filter((x) => x.id !== id) })),
  toggleWhy: (key) => set((s) => ({ whyOpen: { ...s.whyOpen, [key]: !s.whyOpen[key] } })),
}));

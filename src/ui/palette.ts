// Spec §15.3 — tight and deliberate. The three reserved colours (Revenue
// blue, Ichor green, Phlogiston orange) are declared but must not appear
// anywhere until their owners enter the game.

export const INK = '#241C18';
export const MARSH = '#7C8B5E';
export const MARSH_DARK = '#4F5C3C';
export const CLAY = '#9B8265';
export const SEA = '#4A6670';
export const DYKE = '#5E7A7D';
export const LIMEWASH = '#E8E1D2'; // sheep, shingle, plaster
export const ROOF = '#A85D4A';

// Unlocked in M3: the Revenue entered the game wearing the coat (spec §6.10),
// and Heat is now a number the player reads.
export const REVENUE_BLUE = '#2E4A6B';
export const HEAT_RED = '#C4453A';

// Unlocked in M5b: the wight entered the game (spec §6.14) — ichor green
// leaves the reserve with its owner. It belongs to the marsh magic alone:
// the sign, the stone, and the Debt.
export const ICHOR_GREEN = '#6FBF8F';

// Reserved. Do not use yet.
export const PHLOGISTON_ORANGE = '#E09B3D';

export const TERRAIN_FILL: Record<string, string> = {
  c: CLAY,
  '.': MARSH,
  d: DYKE,
  t: CLAY, // Ryne's houses are drawn as assets on top
  s: LIMEWASH,
  '~': SEA,
};

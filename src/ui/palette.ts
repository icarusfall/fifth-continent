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

// Reserved. Do not use yet.
export const REVENUE_BLUE = '#2E4A6B';
export const ICHOR_GREEN = '#6FBF8F';
export const PHLOGISTON_ORANGE = '#E09B3D';
export const HEAT_RED = '#C4453A';

export const TERRAIN_FILL: Record<string, string> = {
  c: CLAY,
  '.': MARSH_DARK,
  p: MARSH,
  f: ROOF,
  d: DYKE,
  t: ROOF,
  s: LIMEWASH,
  '~': SEA,
};

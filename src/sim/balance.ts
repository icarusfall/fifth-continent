// All balance numbers live here. Never inline a magic number. (Spec §13)

import type { CutDepth, Good } from './types';

// ---- Time ----
export const TICKS_PER_HOUR = 6; // one tick = 10 minutes
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY; // 144

// Hour boundaries for time-of-day (spec §6.2: night 0.4, dusk 0.7, day 1.0)
export const DAWN_HOUR = 5; // 05:00–06:59 dusk (half-light)
export const DAY_HOUR = 7; // 07:00–17:59 day
export const DUSK_HOUR = 18; // 18:00–19:59 dusk
export const NIGHT_HOUR = 20; // 20:00–04:59 night

export const TIME_OF_DAY_MOD_NIGHT = 0.4;
export const TIME_OF_DAY_MOD_DUSK = 0.7;
export const TIME_OF_DAY_MOD_DAY = 1.0;

// ---- Tide ----
// A full tide cycle (low → high → low). Deliberately not a divisor of the day,
// so high water walks around the clock and the low road's window keeps moving.
export const TIDE_PERIOD_TICKS = 76; // ~12h40m
// Tide level is a triangle wave in [0, 1]. The low road floods above this.
export const TIDE_FLOOD_THRESHOLD = 0.7;

// ---- The flock (spec §19.2: the flock is your alibi; here it is just wool) ----
export const STARTING_FLOCK = 12;
export const FLEECE_PER_HEAD_PER_DAY = 1; // sheared at dawn, one fleece per sheep
export const SHEARING_HOUR = DAWN_HOUR; // fleece lands in the farm store at dawn

// ---- The cart ----
export const CART_CAPACITY = 8; // fleece per run; 12 sheep/day forces a second run

// ---- The barn (spec §6.9 / §18: storage is scarce — the cap arrives before the Heat) ----
export const FARM_STORE_CAPACITY = 24; // units, all goods together — one lugger-load of wool

// ---- Roads (spec §6.7: latency = max(1, round(pathTileLength × ticksPerTile))) ----
export const LOW_ROAD_TICKS_PER_TILE = 0.26; // flat and direct, when the sea allows
export const HIGH_ROAD_TICKS_PER_TILE = 0.53; // climbs the upland, minds its manners
export const LOW_ROAD_EXPOSURE = 0.5; // base Heat per unit moved (unused until M3)
export const HIGH_ROAD_EXPOSURE = 1.0; // the Customs House watches it (unused until M3)

// ---- Marsh tracks (spec §6.9: no road, just marsh) ----
export const MARSH_TICKS_PER_TILE = 0.33;
export const MARSH_TRACK_EXPOSURE = 0.7; // recorded, not consumed until M3

// ---- Prices ----
// The domestic price is insulting on purpose (spec §10 rung 2).
export const WOOL_PRICE_DOMESTIC = 2; // coin per fleece at Ryne
export const LEIDEN_PRICE_MULT = 4; // the Dutchman's offer

// ---- The Dutchman (spec §6.9: night, falling tide, no credit) ----
export const DUTCHMAN_FLEECE_DEMAND = 24; // fleece he'll take per visit
/** His hold on arrival — restocked each visit. */
export const DUTCHMAN_HOLD: Partial<Record<Good, number>> = {
  jenever: 12,
  tea: 8,
  lace: 4,
};
/** What he charges, coin per unit. */
export const DUTCHMAN_PRICE: Partial<Record<Good, number>> = {
  jenever: 10,
  tea: 4,
  lace: 15,
};

// ---- The cutting house (spec §6.9) ----
export const CUTTING_HOUSE_COST = 60; // coin, sited on open marsh
export const CUT_SUGAR_COST = 2; // coin per tub — water and burnt sugar
/** Depth of cut: volume against tier. The player's hand on the till. */
export const CUTS: Record<CutDepth, { yield: number; brandy: Good }> = {
  gentle: { yield: 2, brandy: 'brandy-gent' },
  standard: { yield: 3, brandy: 'brandy-fair' },
  deep: { yield: 4, brandy: 'brandy-rough' },
};

// ---- The Ryne market: fixed prices, daily appetite (spec §6.9) ----
// §17's moving prices wait for their milestone. Jenever price 0 = no legal buyer.
export const BRANDY_BASE_PRICE = 6;
export const QUALITY_MULT = { rough: 0.6, fair: 1.0, gent: 1.8 } as const; // §17.3
export const RYNE_PRICE: Record<Good, number> = {
  fleece: WOOL_PRICE_DOMESTIC,
  jenever: 0,
  tea: 7,
  lace: 24,
  'brandy-rough': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.rough),
  'brandy-fair': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.fair),
  'brandy-gent': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.gent),
};
/** Units Ryne will buy per day, reset at dawn. Saturation as a wall. */
export const DAILY_DEMAND: Record<Good, number> = {
  fleece: 24,
  jenever: 0,
  tea: 8,
  lace: 2,
  'brandy-rough': 10,
  'brandy-fair': 6,
  'brandy-gent': 2,
};

// ---- Rent (spec §6.8: the first squeeze) ----
export const RENT_AMOUNT = 120; // coin, per period
export const RENT_PERIOD_DAYS = 6; // first due at dawn, this many days after placement
export const SHEEP_VALUE = 10; // the agent's valuation under distraint

// ---- Bookkeeping ----
export const MAX_LOG_EVENTS = 50; // event log ring buffer, part of state

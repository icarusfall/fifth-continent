// All balance numbers live here. Never inline a magic number. (Spec §13)

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

// ---- Roads ----
export const LOW_ROAD_LATENCY = 8; // ticks (~1h20m). Short, flat, floods.
export const HIGH_ROAD_LATENCY = 20; // ticks (~3h20m). Slow. Passes the Customs House.
export const LOW_ROAD_EXPOSURE = 0.5; // base Heat per unit moved (unused until M3)
export const HIGH_ROAD_EXPOSURE = 1.0; // the Customs House watches it (unused until M3)

// ---- Prices ----
// The domestic price is insulting on purpose (spec §10 rung 2).
export const WOOL_PRICE_DOMESTIC = 2; // coin per fleece at Ryne
export const LEIDEN_PRICE_MULT = 4; // M2: the Dutchman's offer

// ---- Bookkeeping ----
export const MAX_LOG_EVENTS = 50; // event log ring buffer, part of state
